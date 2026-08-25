<!--
    FileDetailView.vue — 文件详情(对齐原版 openFileCenterFileDetail + loadFileCenterDetailContent)

    设计:
      - 复用原版全局样式类(.file-center-detail / -head / -title / -meta / -content 等)
      - 文本文件走 /api/files/read 预览;图片文件走 inline 下载 URL
      - 返回按钮回到文件列表
-->

<template>
    <div v-if="file" class="file-center-detail">
        <div class="file-center-detail-head">
            <span class="file-center-file-icon" :class="fileToneClass(file)" aria-hidden="true">
                <i :class="fileIconClass(file)"></i>
            </span>
            <div class="file-center-detail-title">
                <h1 :title="fileDisplayName(file)">{{ fileDisplayName(file) }}</h1>
                <div class="file-center-detail-meta">{{ metaText }}</div>
            </div>
            <div class="file-center-detail-actions">
                <Button variant="secondary" size="icon" icon="fa-solid fa-download" title="下载文件" aria-label="下载文件" @click="handleDownload" />
                <Button variant="danger" size="icon" icon="fa-solid fa-trash-can" title="删除文件" aria-label="删除文件" @click="handleDelete" />
            </div>
        </div>
        <div class="file-center-detail-content" id="fileCenterDetailContent">
            <div v-if="loading" class="file-center-empty">加载中...</div>
            <div v-else-if="isImageFile(file)" class="file-center-detail-image-wrap">
                <img
                class="file-center-detail-image"
                :src="fileDownloadUrl(fileRef(file), true)"
                :alt="fileDisplayName(file)"
                >
            </div>
            <pre v-else-if="content" class="file-center-detail-pre">{{ content }}</pre>
            <div v-else class="file-center-detail-empty">文件内容为空</div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref, watch } from 'vue'

    import type { CloudFileItem } from '@/api/files-center'
    import {
        fileDisplayName,
        fileDownloadUrl,
        fileIconClass,
        fileRef,
        fileToneClass,
        formatFileSize,
        formatFileUpdatedAt,
        isImageFile,
        readFile,
        removeFile,
    } from '@/api/files-center'
    import Button from '@/ui/Button.vue'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'

    const props = defineProps<{
        file: CloudFileItem | null
    }>()

    const emit = defineEmits<{
        /** 删除成功:通知父级关闭详情(文件中心列表随之重载) */
        deleted: []
    }>()

    const content = ref('')
    const loading = ref(false)

    /** 元信息(对齐原版 getFileCenterMetaParts) */
    const metaText = computed(() => {
        if (!props.file) {
            return ''
        }

        const parts = [
            `大小:${formatFileSize(Number(props.file.size || 0))}`,
            formatFileUpdatedAt(Number(props.file.updated_at || 0)),
        ]

        return parts.join(' · ')
    })

    /** 文件变化时加载预览(v-if 挂载时初始 file 即为目标,需 immediate 触发首次加载) */
    watch(
        () => props.file,
        (file) => {
            if (file) {
                void loadPreview(file)
            } else {
                content.value = ''
            }
        },
        { immediate: true }
    )

    /** 下载当前文件(走文件中心下载 URL) */
    function handleDownload(): void {
        if (!props.file) {
            return
        }

        window.location.href = fileDownloadUrl(fileRef(props.file))
    }

    /** 删除当前文件:确认后删除并通知父级关闭详情 */
    async function handleDelete(): Promise<void> {
        const target = props.file

        if (!target) {
            return
        }

        const confirmed = await showConfirm({
            title: '删除文件',
            content: `确定删除文件「${fileDisplayName(target)}」吗?`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await removeFile(fileRef(target))

            showToast('文件已删除', 'success')
            emit('deleted')
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 加载文本预览(对齐原版 loadFileCenterDetailContent) */
    async function loadPreview(file: CloudFileItem): Promise<void> {
        if (isImageFile(file)) {
            return
        }

        loading.value = true

        try {
            const data = await readFile(fileRef(file))

            content.value = data.content
        } catch (error) {
            showError(error instanceof Error ? error.message : '读取文件失败')
        } finally {
            loading.value = false
        }
    }

</script>

<style scoped>
    /* 详情头部操作区(下载/删除右对齐) */
    .file-center-detail-actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
    }
</style>
