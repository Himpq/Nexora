<!--
    TrashModal.vue — 回收站弹窗(GDDP 窗口样式,与设置窗口视觉统一)

    设计:
      - 现代 GDDP Modal(去 legacy,复用 g-modal 圆角/头部/关闭按钮)
      - head 插槽承载 刷新/清空 按钮组,右侧为 GDDP 关闭按钮
      - 列表走分隔线式条目,恢复成功后通知父级刷新会话列表
-->

<template>
    <Modal
        :open="open"
        width="680px"
        modal-class="trash-modal"
        title="回收站"
        @close="emit('close')"
    >
        <template #head>
            <div class="trash-head-left">
                <h3>回收站</h3>
                <div class="trash-head-actions">
                    <Button variant="quiet" size="compact" icon="fa-solid fa-rotate" title="刷新" @click="load">刷新</Button>
                    <Button variant="danger" size="compact" icon="fa-regular fa-trash-can" title="清空回收站" @click="handleClear">清空</Button>
                </div>
            </div>
        </template>

        <div class="trash-cards">
            <div v-if="loading" class="trash-empty-state">加载中...</div>
            <div v-else-if="!items.length" class="trash-empty-state">暂无回收站内容</div>

            <article v-for="item in items" :key="item.id" class="trash-card">
                <div class="trash-card-icon" :class="`trash-card-icon--${item.type}`">
                    <i :class="typeIcon(item.type)" aria-hidden="true"></i>
                </div>

                <div class="trash-card-body">
                    <div class="trash-card-head">
                        <span class="trash-card-title">{{ item.title || '(无标题)' }}</span>
                        <span class="trash-card-type">{{ typeLabel(item.type) }}</span>
                    </div>

                    <p class="trash-card-preview">{{ item.preview || '(无预览)' }}</p>

                    <div class="trash-card-foot">
                        <span class="trash-card-time">
                            <i class="fa-regular fa-clock" aria-hidden="true"></i>
                            删除于 {{ formatDate(item.deleted_at) }}
                        </span>
                        <Button
                            variant="secondary"
                            size="compact"
                            icon="fa-solid fa-rotate-left"
                            @click="handleRestore(item.id)"
                        >恢复</Button>
                    </div>
                </div>
            </article>
        </div>
    </Modal>
</template>

<script setup lang="ts">
    import { ref, watch } from 'vue'

    import type { TrashItem } from '@/api/trash'
    import { clearTrashItems, listTrashItems, restoreTrashItem } from '@/api/trash'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'

    import Button from '@/ui/Button.vue'
    import Modal from '@/ui/Modal.vue'

    const props = defineProps<{
        open: boolean
    }>()

    const emit = defineEmits<{
        close: []
        /** 有条目被恢复:父级应刷新会话列表 */
        restored: []
    }>()

    const items = ref<TrashItem[]>([])
    const loading = ref(false)

    /** 打开时加载一次(对齐原版 openTrashModal → loadTrashList) */
    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                void load()
            }
        }
    )

    /** 拉取回收站列表(原版 loadTrashList,limit=200) */
    async function load(): Promise<void> {
        if (loading.value) {
            return
        }

        loading.value = true

        try {
            items.value = await listTrashItems(200)
        } catch (error) {
            showError(error instanceof Error ? error.message : '读取回收站失败')
        } finally {
            loading.value = false
        }
    }

    /** 恢复单个条目:成功后刷新列表并通知父级刷新会话(原版 restoreTrashItem) */
    async function handleRestore(trashId: string): Promise<void> {
        if (loading.value) {
            return
        }

        try {
            await restoreTrashItem(trashId)

            showToast('已恢复', 'success')
            await load()

            emit('restored')
        } catch (error) {
            showError(error instanceof Error ? error.message : '恢复失败')
        }
    }

    /** 清空回收站:确认后调用(原版 clearTrashItemsWithConfirm) */
    async function handleClear(): Promise<void> {
        const confirmed = await showConfirm({
            title: '清空回收站',
            content: '确定清空回收站吗?该操作不可撤销。',
            confirmText: '清空',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            const removed = await clearTrashItems()

            showToast(`已清空 ${removed} 项`, 'success')
            await load()
        } catch (error) {
            showError(error instanceof Error ? error.message : '清空失败')
        }
    }

    /** 类型中文标签(原版 formatTrashTypeLabel) */
    function typeLabel(type: string): string {
        if (type === 'conversation') {
            return '对话'
        }

        if (type === 'knowledge_basis') {
            return '知识库'
        }

        return type || '未知'
    }

    /** 类型图标(对话/知识库,其余回落文件图标) */
    function typeIcon(type: string): string {
        if (type === 'conversation') {
            return 'fa-regular fa-comments'
        }

        if (type === 'knowledge_basis') {
            return 'fa-solid fa-book'
        }

        return 'fa-regular fa-file'
    }

    /** 时间格式化(原版 formatTrashDate) */
    function formatDate(raw: string): string {
        if (!raw) {
            return '-'
        }

        try {
            return new Date(raw).toLocaleString()
        } catch {
            return raw
        }
    }
</script>

<style scoped>
    .trash-head-left {
        display: flex;
        align-items: center;
        gap: 14px;
    }

    .trash-head-actions {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .trash-cards {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 2px 0 6px;
        max-height: min(54vh, 480px);
        overflow-y: auto;
    }

    .trash-empty-state {
        padding: 48px 0 56px;
        color: #94a3b8;
        font-size: 13px;
        text-align: center;
    }

    /* 回收站条目卡片(独立前缀,避开原版 style.css 的 .trash-* 全局样式叠加) */
    .trash-card {
        display: flex;
        gap: 12px;
        padding: 12px 14px;
        border: 1px solid #e8eef7;
        border-radius: 10px;
        background: #fff;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .trash-card:hover {
        border-color: #cbd5e1;
        box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
    }

    .trash-card-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 38px;
        width: 38px;
        height: 38px;
        border-radius: 10px;
        font-size: 15px;
    }

    .trash-card-icon--conversation {
        background: #eef2ff;
        color: #4f46e5;
    }

    .trash-card-icon--knowledge_basis {
        background: #f5f3ff;
        color: #7c3aed;
    }

    .trash-card-icon:not(.trash-card-icon--conversation):not(.trash-card-icon--knowledge_basis) {
        background: #f1f5f9;
        color: #475569;
    }

    .trash-card-body {
        flex: 1 1 auto;
        min-width: 0;
    }

    .trash-card-head {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 4px;
    }

    .trash-card-title {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #0f172a;
        font-size: 14px;
        font-weight: 600;
    }

    .trash-card-type {
        flex: 0 0 auto;
        padding: 1px 8px;
        border-radius: 999px;
        background: #f1f5f9;
        color: #475569;
        font-size: 11px;
        line-height: 18px;
    }

    .trash-card-preview {
        margin: 0 0 10px;
        color: #64748b;
        font-size: 12px;
        line-height: 1.5;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .trash-card-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
    }

    .trash-card-time {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #94a3b8;
        font-size: 11px;
    }

    .trash-card-time i {
        margin-right: 4px;
    }
</style>
