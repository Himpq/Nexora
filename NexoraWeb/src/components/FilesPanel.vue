<!--
    FilesPanel.vue — 云端文件右侧栏(逐像素复刻原版 filePanel 结构)

    结构(与原版 chat.html #filePanel 一致):
      aside.knowledge-sidebar > k-header(搜索/上传/刷新/关闭) + k-content(FILES 列表)
-->

<template>
    <aside ref="panelRef" class="knowledge-sidebar" id="filePanel" :class="{ visible: open }">
        <div class="k-header">
            <div style="flex:1;">
                <h3 style="margin-bottom: 6px;">Cloud Files</h3>
                <div class="k-search" style="display:flex; gap:6px;">
                    <input
                        v-model="query"
                        class="gddp-input"
                        placeholder="搜索文件..."
                        style="flex:1; font-size:12px; height: 28px; padding: 4px 8px;"
                        @keydown.enter="loadFiles"
                    />
                    <button
                        class="btn-primary btn-compact"
                        type="button"
                        @click="loadFiles"
                    >
                        搜索
                    </button>
                </div>
            </div>
            <div class="k-actions" style="align-self: flex-start; margin-top: 2px;">
                <button class="btn-icon-small" id="refreshCloudFilesBtn" title="Refresh" @click="loadFiles">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <polyline points="1 20 1 14 7 14"></polyline>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                </button>
                <button class="btn-icon-small" id="btnToggleFilePanel" title="Close" @click="emit('close')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        </div>

        <div class="k-content">
            <div class="k-section" style="margin-bottom:0;">
                <div class="k-section-title">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span>FILES</span>
                        <span class="badge" id="cloudFileCount">{{ files.length }}</span>
                    </div>
                </div>
                <div id="cloudFileList" class="k-list">
                    <div v-if="loading" class="k-list-empty">加载中...</div>
                    <div v-else-if="!files.length" class="k-list-empty">暂无文件</div>
                        <div
                            v-for="file in files"
                            :key="fileRef(file)"
                            class="cloud-file-item"
                            :title="`${fileDisplayName(file)}\n大小:${formatSize(file.size)}`"
                        >
                        <div class="cloud-file-main">
                            <div class="cloud-file-head">
                                <div class="cloud-file-name">{{ fileDisplayName(file) }}</div>
                                <div class="cloud-file-actions">
                                    <button
                                        class="cloud-file-btn cloud-file-attach"
                                        type="button"
                                        title="附加到输入框"
                                        @click.stop="handleAttach(file)"
                                    >
                                        <i class="fa-solid fa-circle-plus" aria-hidden="true"></i>
                                    </button>
                                    <a
                                        class="cloud-file-btn cloud-file-download"
                                        :href="`/api/files/download?file_ref=${encodeURIComponent(fileRef(file))}`"
                                        title="下载"
                                        @click.stop
                                    >
                                        <i class="fa-solid fa-download" aria-hidden="true"></i>
                                    </a>
                                    <button
                                        class="cloud-file-btn cloud-file-delete"
                                        type="button"
                                        title="删除"
                                        @click.stop="handleDelete(file)"
                                    >
                                        <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="cloud-file-meta">
                                <span class="cloud-file-size">{{ formatSize(file.size) }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </aside>
</template>

<script setup lang="ts">
    import { onMounted, ref, watch } from 'vue'

    import { fileDisplayName, fileRef, listFiles, type CloudFileItem } from '@/api/files-center'
    import type { AttachmentInput } from '@/api/attachments'
    import { showError, showToast } from '@/stores/notify'
    import { registerPanel } from '@/ui/overlay'

    const props = defineProps<{
        open: boolean
    }>()

    const emit = defineEmits<{
        close: []
        /** 附加文件到输入框(对齐原版 attachCloudFileAsAttachment 的 uploadedFileIds 条目) */
        attach: [attachment: AttachmentInput]
    }>()

    const query = ref('')
    const files = ref<CloudFileItem[]>([])
    const loading = ref(false)
    const panelRef = ref<HTMLElement | null>(null)

    /** 注册右侧栏到浮层协调器:点击外部自动关闭(含触发按钮豁免) */
    onMounted(() => {
        registerPanel('files', panelRef.value, [
            document.getElementById('toggleFilePanel'),
            document.getElementById('fileCenterBtn'),
        ])
    })

    /** 面板打开时才加载文件列表(避免挂载即请求) */
    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                void loadFiles()
            }
        }
    )

    async function loadFiles(): Promise<void> {
        loading.value = true

        try {
            const result = await listFiles(query.value.trim())

            files.value = result.files
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载文件列表失败')
        } finally {
            loading.value = false
        }
    }

    /** 附加到输入框(对齐原版 attachCloudFileAsAttachment) */
    function handleAttach(file: CloudFileItem): void {
        const sandbox = String(file.sandbox_path || '').trim()

        if (!sandbox) {
            showToast('文件路径无效,无法附加', 'warning')

            return
        }

        const displayName = fileDisplayName(file) || sandbox

        emit('attach', {
            type: 'sandbox_file',
            name: displayName,
            original_name: displayName,
            sandbox_path: sandbox,
            stored_path: sandbox,
            size: Number(file.size || 0),
        })
    }

    /** 删除文件(原版 data-action=delete) */
    async function handleDelete(file: CloudFileItem): Promise<void> {
        try {
            const res = await fetch(`/api/files/remove?file_ref=${encodeURIComponent(fileRef(file))}`, {
                method: 'DELETE',
            })

            const data = await res.json()

            if (!res.ok || !data.success) {
                throw new Error(data.message || '删除失败')
            }

            showToast('文件已删除', 'success')
            await loadFiles()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    function formatSize(size?: number): string {
        const bytes = Number(size || 0)

        if (!Number.isFinite(bytes) || bytes <= 0) {
            return ''
        }

        if (bytes >= 1024 * 1024) {
            return `${(bytes / 1024 / 1024).toFixed(1)}MB`
        }

        if (bytes >= 1024) {
            return `${(bytes / 1024).toFixed(1)}KB`
        }

        return `${bytes}B`
    }
</script>

<style scoped>
    /*
     * 对齐原版:cloud-file-* 与 k-list 样式全部来自原版 style.css,
     * 此处只补原版没有的最小空态样式。
     */

    .k-list-empty {
        color: var(--color-text-secondary);
        font-size: 12px;
        text-align: center;
        padding: 20px 0;
    }
</style>
