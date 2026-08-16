<!--
    TrashModal.vue — 回收站弹窗(对齐原版 trashModal)

    设计:
      - 复用原版全局样式类(.trash-modal-custom / .trash-head-btn / .trash-item 等,来自 style.css)
      - 窗口骨架走统一 ui/Modal.vue(head 插槽承载 清空/刷新/关闭 按钮组)
      - 恢复成功后通知父级刷新会话列表(原版 restore 后 loadConversations)
-->

<template>
    <Modal
        :open="open"
        legacy
        root-id="trashModal"
        modal-class="trash-modal-custom"
        :show-close="false"
        @close="emit('close')"
    >
        <template #head>
            <h3>回收站</h3>
            <div class="trash-modal-head-actions">
                <button
                    type="button"
                    class="trash-head-btn trash-head-btn-danger"
                    title="清空回收站"
                    @click="handleClear"
                >
                    <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
                    <span>清空</span>
                </button>
                <button type="button" class="trash-head-btn" title="刷新" @click="load">
                    <i class="fa-solid fa-rotate" aria-hidden="true"></i>
                    <span>刷新</span>
                </button>
                <button type="button" class="btn-modal-close" title="关闭" @click="emit('close')">×</button>
            </div>
        </template>

        <div class="trash-list">
            <div v-if="loading" class="trash-empty">加载中...</div>
            <div v-else-if="!items.length" class="trash-empty">暂无回收站内容</div>

            <article v-for="item in items" :key="item.id" class="trash-item">
                <div class="trash-item-head">
                    <span class="trash-item-type">{{ typeLabel(item.type) }}</span>
                    <span class="trash-item-time">删除时间:{{ formatDate(item.deleted_at) }}</span>
                </div>
                <div class="trash-item-title">{{ item.title || '(无标题)' }}</div>
                <div class="trash-item-preview">{{ item.preview || '(无预览)' }}</div>
                <div class="trash-item-meta">删改日期:{{ formatDate(item.changed_at || item.deleted_at) }}</div>
                <div class="trash-item-actions">
                    <button type="button" class="trash-action-btn" @click="handleRestore(item.id)">恢复</button>
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
