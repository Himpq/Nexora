<!--
    FilesCenterView.vue — 文件中心(对齐原版 openFilesFrameView 的 home 视图)

    设计:
      - 样式走 styles/files-center.css(gddp-files-* 域类,自 legacy/style.css 收编)
      - 文件列表(卡片网格) + 搜索 + 排序 + 上传 + 刷新 + 返回
      - 点击文件选中,双击打开详情(文本预览);删除/下载走右上角操作
      - 视图切换由父级控制(替换主内容区)
-->

<template>
    <section class="gddp-files-view" aria-label="Files">
        <div class="gddp-files-shell" id="fileCenterShell">
            <div class="gddp-files-head">
                <div>
                    <h1>Files</h1>
                    <div class="gddp-files-count-line">
                        <span id="fileCenterCount">{{ files.length }}</span>
                        <span>项</span>
                    </div>
                    <div class="gddp-files-breadcrumb" id="fileCenterBreadcrumb">{{ currentPath || '全部文件' }}</div>
                </div>
                <div class="gddp-files-actions">
                    <Button
                        v-if="currentPath"
                        variant="secondary"
                        size="icon"
                        icon="fa-solid fa-arrow-left"
                        title="返回上一级"
                        aria-label="返回上一级"
                        @click="goBack"
                    />
                    <label class="gddp-files-search">
                        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                        <input
                            v-model="query"
                            type="search"
                            placeholder="搜索文件"
                            aria-label="搜索文件"
                            @keydown.enter="load"
                        >
                    </label>
                    <SettingSelect
                        v-model="sortBy"
                        :options="sortOptions"
                        width="150px"
                        popover-key="files-sort"
                    />
                    <Button
                        variant="secondary"
                        size="icon"
                        icon="fa-solid fa-download"
                        title="下载选中文件"
                        aria-label="下载选中文件"
                        :disabled="!selectedFile"
                        @click="selectedFile && handleDownload(selectedFile)"
                    />
                    <Button
                        variant="secondary"
                        size="icon"
                        icon="fa-solid fa-trash-can"
                        title="删除选中文件"
                        aria-label="删除选中文件"
                        :disabled="!selectedFile"
                        @click="selectedFile && handleDelete(selectedFile)"
                    />
                    <Button
                        variant="secondary"
                        size="icon"
                        icon="fa-solid fa-rotate-right"
                        title="刷新"
                        aria-label="刷新"
                        @click="load"
                    />
                    <Button variant="primary" @click="uploadDialogOpen = true">
                        <i class="fa-solid fa-upload" aria-hidden="true"></i>
                        上传
                    </Button>
                </div>
            </div>

            <div class="gddp-files-layout">
                <div class="gddp-files-list" role="listbox" aria-label="文件列表">
                    <div v-if="loading" class="gddp-files-empty">加载中...</div>
                    <div v-else-if="!files.length" class="gddp-files-empty">暂无文件</div>
                    <template v-else>
                        <div
                            v-for="file in sortedFiles"
                            :key="fileRef(file)"
                            class="gddp-files-card"
                            :class="{ active: selectedRef === fileRef(file) }"
                            role="option"
                            tabindex="0"
                            :aria-selected="selectedRef === fileRef(file)"
                            :title="cardTitle(file)"
                            @click="selectFile(file)"
                            @dblclick="openDetail(file)"
                            @contextmenu.prevent="openFileMenu($event, file)"
                        >
                            <div class="gddp-files-card-icon-wrap">
                                <span class="gddp-files-file-icon" :class="fileToneClass(file)">
                                    <i :class="fileIconClass(file)" aria-hidden="true"></i>
                                </span>
                            </div>
                            <div class="gddp-files-card-name">{{ fileDisplayName(file) }}</div>
                        </div>
                    </template>
                </div>
            </div>
        </div>

        <FileUploadDialog
            :open="uploadDialogOpen"
            @close="uploadDialogOpen = false"
            @uploaded="load"
        />

        <!-- 文件右键菜单:下载/删除/归入移出工作区(参考会话右键的移入移出) -->
        <ContextMenu
            ref="fileMenuRef"
            target-type="cloud_file"
            :file-ref="menuFile ? cloudFileRef(menuFile) : ''"
            :file-alias="menuFile ? String(menuFile.alias || '') : ''"
            :title="menuFile ? fileDisplayName(menuFile) : ''"
            :pinned="false"
            @download-file="handleMenuDownload"
            @request-delete-file="handleMenuDelete"
        />
    </section>
</template>

<script setup lang="ts">
    import { computed, ref, watch } from 'vue'

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
    } from '@/api/files-center'
    import ContextMenu from '@/components/ContextMenu.vue'
    import FileUploadDialog from '@/components/FileUploadDialog.vue'
    import Button from '@/ui/Button.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'
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
    const uploadDialogOpen = ref(false)

    /** 当前选中文件(头栏下载/删除按钮数据源) */
    const selectedFile = computed(() => {
        if (!selectedRef.value) {
            return null
        }

        return files.value.find((file) => fileRef(file) === selectedRef.value) || null
    })

    /** 当前右键菜单目标文件(坐标经 open(x, y) 传入,不进状态) */
    const menuFile = ref<CloudFileItem | null>(null)

    const fileMenuRef = ref<InstanceType<typeof ContextMenu> | null>(null)

    /** 文件右键:选中 + 弹出工作区归入/移出菜单(镜像会话右键菜单) */
    function openFileMenu(event: MouseEvent, file: CloudFileItem): void {
        selectFile(file)
        menuFile.value = file

        fileMenuRef.value?.open(event.clientX, event.clientY)
    }

    /** 右键菜单:下载当前文件 */
    function handleMenuDownload(): void {
        if (menuFile.value) {
            handleDownload(menuFile.value)
        }
    }

    /** 右键菜单:删除当前文件(复用头栏删除的确认链路,成功后刷新列表) */
    function handleMenuDelete(): void {
        if (menuFile.value) {
            void handleDelete(menuFile.value)
        }
    }

    const sortOptions = [
        { value: 'created_desc', label: '上传时间' },
        { value: 'name_asc', label: '文件名称' },
    ]

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
            }
        },
        { immediate: true }
    )

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

    /** 返回上一级目录(当前实现为无目录导航,保持全部文件) */
    function goBack(): void {
        currentPath.value = ''

        void load()
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
