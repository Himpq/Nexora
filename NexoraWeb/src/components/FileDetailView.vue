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
            <button class="file-center-tool-btn" type="button" title="返回" aria-label="返回" @click="emit('back')">
                <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
            </button>
            <span class="file-center-file-icon" :class="fileToneClass(file)" aria-hidden="true">
                <i :class="fileIconClass(file)"></i>
            </span>
            <div class="file-center-detail-title">
                <h1 :title="fileDisplayName(file)">{{ fileDisplayName(file) }}</h1>
                <div class="file-center-detail-meta">{{ metaText }}</div>
            </div>
            <div class="file-center-detail-actions">
                <button class="file-center-tool-btn" type="button" title="下载" aria-label="下载" @click="download">
                    <i class="fa-solid fa-download" aria-hidden="true"></i>
                </button>
            </div>
        </div>
        <div class="file-center-detail-content" id="fileCenterDetailContent">
            <div v-if="loading" class="file-center-empty">加载中...</div>
            <img
                v-else-if="isImageFile(file)"
                class="file-center-detail-image"
                :src="fileDownloadUrl(fileRef(file), true)"
                :alt="fileDisplayName(file)"
            >
            <pre v-else class="file-center-detail-text">{{ content || '(无文本内容)' }}</pre>
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
    } from '@/api/files-center'
    import { showError } from '@/stores/notify'

    const props = defineProps<{
        file: CloudFileItem | null
    }>()

    const emit = defineEmits<{
        back: []
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

    /** 下载文件 */
    function download(): void {
        if (props.file) {
            window.location.href = fileDownloadUrl(fileRef(props.file))
        }
    }
</script>
