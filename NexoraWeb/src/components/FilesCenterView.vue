<!--
    FilesCenterView.vue — 文件中心(对齐原版 openFilesFrameView 的 home 视图)

    设计:
      - 复用原版全局样式类(.file-center-view / -shell / -head / -list / -card 等,来自 chat_files.css)
      - 文件列表(卡片网格) + 搜索 + 排序 + 上传 + 刷新 + 返回
      - 点击文件选中,双击打开详情(文本预览);删除/下载走右上角操作
      - 视图切换由父级控制(替换主内容区)
-->

<template>
    <section class="file-center-view" aria-label="Files">
        <div class="file-center-shell" id="fileCenterShell">
            <div class="file-center-head">
                <div>
                    <h1>Files</h1>
                    <div class="file-center-count-line">
                        <span id="fileCenterCount">{{ files.length }}</span>
                        <span>项</span>
                    </div>
                    <div class="file-center-breadcrumb" id="fileCenterBreadcrumb">{{ currentPath || '全部文件' }}</div>
                </div>
                <div class="file-center-actions">
                    <button
                        class="file-center-tool-btn"
                        type="button"
                        title="返回上一级"
                        aria-label="返回上一级"
                        :disabled="!currentPath"
                        @click="goBack"
                    >
                        <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                    </button>
                    <label class="file-center-search">
                        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                        <input
                            v-model="query"
                            type="search"
                            placeholder="搜索文件"
                            aria-label="搜索文件"
                            @keydown.enter="load"
                        >
                    </label>
                    <div class="tool-mode-dropdown file-center-sort-dropdown" :class="{ open: sortMenuOpen }">
                        <button
                            class="tool-mode-trigger file-center-sort-trigger"
                            type="button"
                            aria-haspopup="listbox"
                            :aria-expanded="sortMenuOpen"
                            title="排序方式"
                            @click.stop="sortMenuOpen = !sortMenuOpen"
                        >
                            <i class="fa-solid fa-arrow-down-wide-short" aria-hidden="true"></i>
                            <span>{{ sortBy === 'name_asc' ? '文件名称' : '上传时间' }}</span>
                            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                        </button>
                        <div class="tool-mode-menu file-center-sort-menu" role="listbox" aria-label="排序方式">
                            <button
                                type="button"
                                class="tool-mode-item"
                                role="option"
                                :class="{ active: sortBy === 'created_desc' }"
                                :aria-selected="sortBy === 'created_desc'"
                                @click="setSort('created_desc')"
                            >上传时间</button>
                            <button
                                type="button"
                                class="tool-mode-item"
                                role="option"
                                :class="{ active: sortBy === 'name_asc' }"
                                :aria-selected="sortBy === 'name_asc'"
                                @click="setSort('name_asc')"
                            >文件名称</button>
                        </div>
                    </div>
                    <button class="file-center-tool-btn" type="button" title="刷新" aria-label="刷新" @click="load">
                        <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                    </button>
                    <button class="file-center-upload-btn" type="button" @click="openFilePicker">
                        <i class="fa-solid fa-upload" aria-hidden="true"></i>
                        <span>上传</span>
                    </button>
                    <input
                        ref="fileInputRef"
                        type="file"
                        multiple
                        hidden
                        @change="handleFilesSelected"
                    >
                </div>
            </div>

            <div class="file-center-layout">
                <div class="file-center-list" role="listbox" aria-label="文件列表">
                    <div v-if="loading" class="file-center-empty">加载中...</div>
                    <div v-else-if="!files.length" class="file-center-empty">暂无文件</div>
                    <template v-else>
                        <div
                            v-for="file in sortedFiles"
                            :key="fileRef(file)"
                            class="file-center-card"
                            :class="{ active: selectedRef === fileRef(file) }"
                            role="option"
                            tabindex="0"
                            :aria-selected="selectedRef === fileRef(file)"
                            :title="cardTitle(file)"
                            @click="selectFile(file)"
                            @dblclick="openDetail(file)"
                        >
                            <div class="file-center-card-icon-wrap">
                                <span class="file-center-file-icon" :class="fileToneClass(file)">
                                    <i :class="fileIconClass(file)" aria-hidden="true"></i>
                                </span>
                            </div>
                            <div class="file-center-card-name">{{ fileDisplayName(file) }}</div>
                        </div>
                    </template>
                </div>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, ref, watch } from 'vue'

    import type { CloudFileItem } from '@/api/files-center'
    import {
        fileDisplayName,
        fileDownloadUrl,
        fileIconClass,
        fileRef as cloudFileRef,
        fileToneClass,
        formatFileSize,
        formatFileUpdatedAt,
        isImageFile,
        listFiles,
        removeFile,
        uploadFile,
    } from '@/api/files-center'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'

    const emit = defineEmits<{
        close: []
        'open-detail': [file: CloudFileItem]
    }>()

    const props = defineProps<{
        open: boolean
    }>()

    const files = ref<CloudFileItem[]>([])
    const loading = ref(false)
    const query = ref('')
    const currentPath = ref('')
    const selectedRef = ref('')
    const sortBy = ref<'created_desc' | 'name_asc'>('created_desc')
    const sortMenuOpen = ref(false)
    const fileInputRef = ref<HTMLInputElement | null>(null)
    const uploading = ref(false)

    /** 排序后的文件列表(对齐原版 sortFileCenterDirectoryEntries) */
    const sortedFiles = computed(() => {
        const arr = files.value.slice()

        if (sortBy.value === 'name_asc') {
            arr.sort((a, b) => fileDisplayName(a).localeCompare(fileDisplayName(b), 'zh-CN'))
        } else {
            arr.sort((a, b) => (Number(b.updated_at || 0)) - (Number(a.updated_at || 0)))
        }

        return arr
    })

    /** 打开时加载一次(v-if 挂载时初始 open 即为 true,需 immediate 触发首次加载) */
    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                void load()

                document.addEventListener('click', handleOutsideClick)
            } else {
                sortMenuOpen.value = false

                document.removeEventListener('click', handleOutsideClick)
            }
        },
        { immediate: true }
    )

    onBeforeUnmount(() => {
        document.removeEventListener('click', handleOutsideClick)
    })

    /** 外部点击关闭排序下拉(自建下拉统一处理) */
    function handleOutsideClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null

        if (!target || target.closest('.file-center-sort-dropdown')) {
            return
        }

        sortMenuOpen.value = false
    }

    /** 加载文件列表(对齐原版 loadFileCenterFiles) */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            const data = await listFiles(query.value.trim() || currentPath.value, 1000)

            files.value = data.files
            selectedRef.value = ''
        } catch (error) {
            showError(error instanceof Error ? error.message : '文件列表读取失败')
        } finally {
            loading.value = false
        }
    }

    /** 文件 ref(对齐原版 getCloudFileRef:sandbox_path 优先) */
    function fileRef(file: CloudFileItem): string {
        return cloudFileRef(file)
    }

    /** 卡片 title 多行详情(对齐原版 titleLines) */
    function cardTitle(file: CloudFileItem): string {
        const name = fileDisplayName(file)
        const original = String(file.original_name || '').trim()
        const size = formatFileSize(Number(file.size || 0))
        const updated = formatFileUpdatedAt(Number(file.updated_at || 0))

        return [name, original && original !== name ? original : '', `大小:${size}`, updated !== '-' ? `更新:${updated}` : ''].filter(Boolean).join('\n')
    }

    /** 选中文件 */
    function selectFile(file: CloudFileItem): void {
        selectedRef.value = fileRef(file)
    }

    /** 双击打开详情 */
    function openDetail(file: CloudFileItem): void {
        selectedRef.value = fileRef(file)

        emit('open-detail', file)
    }

    /** 设置排序并关闭下拉 */
    function setSort(value: 'created_desc' | 'name_asc'): void {
        sortBy.value = value
        sortMenuOpen.value = false
    }

    /** 返回上一级目录(当前实现为无目录导航,保持全部文件) */
    function goBack(): void {
        currentPath.value = ''

        void load()
    }

    /** 打开文件选择器 */
    function openFilePicker(): void {
        fileInputRef.value?.click()
    }

    /** 选择文件后上传(对齐原版 uploadFileCenterFiles) */
    async function handleFilesSelected(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement
        const selected = Array.from(input.files || [])

        input.value = ''

        if (!selected.length || uploading.value) {
            return
        }

        uploading.value = true

        try {
            for (const file of selected) {
                await uploadFile(file, currentPath.value, () => {})
            }

            showToast(`已上传 ${selected.length} 个文件`, 'success')
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '上传失败')
        } finally {
            uploading.value = false
        }
    }

    /** 删除选中文件 */
    async function handleDelete(file: CloudFileItem): Promise<void> {
        const confirmed = await showConfirm({
            title: '删除文件',
            content: `确定删除文件「${fileDisplayName(file)}」吗?`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await removeFile(fileRef(file))

            showToast('文件已删除', 'success')
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 下载文件 */
    function handleDownload(file: CloudFileItem): void {
        window.location.href = fileDownloadUrl(fileRef(file))
    }

    defineExpose({ handleDelete, handleDownload, isImageFile, fileDownloadUrl: (file: CloudFileItem) => fileDownloadUrl(fileRef(file), true) })
</script>
