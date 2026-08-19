<!--
    KnowledgePanel.vue — 知识库列表右侧栏(GDDP 视觉)

    职责:
      - 搜索 / 列表 / 新建空白知识库 / 打开文档
      - 正文编辑器由主内容 KnowledgeViewer 承载(emit open-document)
      - 浮层协调器管理开合(registerPanel + visible class)
    定位与滑入动画复用原版 .knowledge-sidebar 全局样式(style.css)
-->

<template>
    <aside ref="panelRef" class="knowledge-sidebar" id="knowledgePanel" :class="{ visible: open }">
        <div class="k-header">
            <div class="knowledge-panel-heading">
                <h3>Knowledge</h3>
                <div class="k-search">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <input
                        id="knowledgeSearchInput"
                        v-model="query"
                        type="search"
                        placeholder="搜索向量库..."
                        @keydown.enter="loadKnowledge"
                    >
                    <Button variant="quiet" size="compact" @click="loadKnowledge">搜索</Button>
                </div>
            </div>
            <div class="k-actions">
                <Button
                    variant="quiet"
                    size="icon"
                    title="刷新"
                    aria-label="刷新"
                    icon="fa-solid fa-rotate-right"
                    @click="loadKnowledge"
                />
                <Button
                    variant="quiet"
                    size="icon"
                    title="关闭"
                    aria-label="关闭"
                    icon="fa-solid fa-xmark"
                    @click="emit('close')"
                />
            </div>
        </div>

        <div class="k-content">
            <div class="k-section">
                <div class="k-section-title">
                    <span class="k-section-label">
                        <span>BASIS</span>
                        <span class="k-count">{{ filteredItems.length }}</span>
                    </span>
                    <span class="k-section-actions">
                        <Button
                            variant="quiet"
                            size="icon"
                            title="新建空白知识库"
                            aria-label="新建空白知识库"
                            icon="fa-solid fa-plus"
                            @click="handleCreateBlank"
                        />
                    </span>
                </div>

                <div id="panelBasisKnowledgeList" class="k-list">
                    <div v-if="loading" class="k-list-empty">加载中...</div>
                    <div v-else-if="!filteredItems.length" class="k-list-empty">暂无知识库</div>
                    <button
                        v-for="item in filteredItems"
                        :key="item.title"
                        type="button"
                        class="knowledge-item"
                        :class="{ active: selectedTitle === item.title }"
                        :title="item.title"
                        @click="selectItem(item.title)"
                        @contextmenu.prevent="openContextMenu($event, item)"
                    >
                        <i class="fa-solid fa-book" aria-hidden="true"></i>
                        <span class="knowledge-item-title">{{ item.title }}</span>
                        <i v-if="item.pin" class="fa-solid fa-thumbtack knowledge-item-pin" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
        </div>

        <!-- 知识库右键菜单(置顶/解除置顶 + 归入工作区,保留面板打开;popoverId 与会话菜单互斥) -->
        <ContextMenu
            v-if="menuItem"
            :armed="!!menuItem"
            :x="menuX"
            :y="menuY"
            popover-id="context-menu-knowledge"
            target-type="knowledge_basis"
            :title="menuItem.title"
            :pinned="!!menuItem.pin"
            keep-panel
            @pin-changed="handleKnowledgePinChanged"
            @request-delete-basis="handleRequestDeleteBasis"
        />
    </aside>
</template>

<script setup lang="ts">
    import { computed, onMounted, ref, watch } from 'vue'

    import {
        createBlankBasis,
        deleteBasisKnowledge,
        fetchKnowledgeContent,
        fetchKnowledgeSidebar,
        vectorizeKnowledge,
        type KnowledgeItem,
    } from '@/api/knowledge'
    import Button from '@/ui/Button.vue'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'
    import { openPopover, overlay, registerPanel } from '@/ui/overlay'

    import ContextMenu from './ContextMenu.vue'

    const props = defineProps<{ open: boolean }>()

    const emit = defineEmits<{
        close: []
        'open-document': [title: string]
        'document-deleted': [title: string]
    }>()

    const query = ref('')
    const items = ref<KnowledgeItem[]>([])
    const selectedTitle = ref('')
    const loading = ref(false)
    const vectorizing = ref(false)
    const panelRef = ref<HTMLElement | null>(null)

    /** 右键菜单位置与目标知识库 */
    const menuX = ref(0)
    const menuY = ref(0)
    const menuItem = ref<KnowledgeItem | null>(null)

    /** 按关键词过滤知识库列表;置顶项排前(对齐原版 sortKnowledgeList) */
    const filteredItems = computed(() => {
        const keyword = query.value.trim().toLowerCase()

        return items.value
            .filter((item) => !keyword || item.title.toLowerCase().includes(keyword))
            .sort((a, b) => {
                const aPinned = !!a.pin
                const bPinned = !!b.pin

                if (aPinned !== bPinned) {
                    return aPinned ? -1 : 1
                }

                return 0
            })
    })

    /** 菜单被关闭(外部点击/操作完成)时清空目标;与其他菜单以不同 popoverId 互斥 */
    watch(
        () => overlay.popover,
        (popover) => {
            if (popover !== 'context-menu-knowledge') {
                menuItem.value = null
            }
        }
    )

    /** 注册右侧栏到浮层协调器:点击外部自动关闭(含触发按钮豁免) */
    onMounted(() => {
        registerPanel('knowledge', panelRef.value, [document.getElementById('toggleKnowledgePanel')])
    })

    /** 面板打开时才加载列表 */
    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                void loadKnowledge()
            }
        },
        { immediate: true }
    )

    async function loadKnowledge(): Promise<void> {
        loading.value = true

        try {
            items.value = await fetchKnowledgeSidebar()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载知识库失败')
        } finally {
            loading.value = false
        }
    }

    /** 选中知识库:记录高亮并交给主内容 KnowledgeViewer 打开 */
    function selectItem(title: string): void {
        selectedTitle.value = title
        emit('open-document', title)
    }

    /** 打开知识库右键菜单(保留面板打开,对齐原版 showPinContextMenu + targetType=knowledge_basis) */
    function openContextMenu(event: MouseEvent, item: KnowledgeItem): void {
        menuItem.value = item
        menuX.value = event.clientX
        menuY.value = event.clientY
        openPopover('context-menu-knowledge', null, { keepPanel: true })
    }

    /** 知识库置顶状态变化:本地更新 pin 并触发排序(对齐原版 setBasisPinLocal) */
    function handleKnowledgePinChanged(targetType: string, title: string, pinned: boolean): void {
        if (targetType !== 'knowledge_basis') {
            return
        }

        const item = items.value.find((entry) => entry.title === title)

        if (item) {
            item.pin = pinned
        }
    }

    /** 知识库右键菜单删除请求:确认后删除(后端移入回收站),刷新列表;若正打开该文档则通知上层关闭正文 */
    async function handleRequestDeleteBasis(title: string): Promise<void> {
        const confirmed = await showConfirm({
            title: '删除知识库',
            content: `确定要删除知识库「${title}」吗?删除后将移入回收站。`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await deleteBasisKnowledge(title)

            if (selectedTitle.value === title) {
                selectedTitle.value = ''
                emit('document-deleted', title)
            }

            void loadKnowledge()

            showToast('知识库已删除', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 新建空白知识库:创建后刷新列表并打开编辑器 */
    async function handleCreateBlank(): Promise<void> {
        try {
            const title = await createBlankBasis()

            showToast('空白知识库已创建', 'success')
            selectedTitle.value = title
            await loadKnowledge()
            emit('open-document', title)
        } catch (error) {
            showError(error instanceof Error ? error.message : '创建空白知识库失败')
        }
    }

    /** 全部向量化:逐个读取正文并重新向量化(面板内进度提示;按钮已移除,逻辑保留待后续入口恢复) */
    async function handleVectorizeAll(): Promise<void> {
        if (vectorizing.value || !items.value.length) {
            showToast('暂无知识库可向量化', 'info')

            return
        }

        vectorizing.value = true

        let succeeded = 0
        const failures: string[] = []
        let firstError = ''

        for (const item of items.value) {
            try {
                const data = await fetchKnowledgeContent(item.title)

                await vectorizeKnowledge(item.title, data.content || '')
                succeeded += 1
            } catch (error) {
                failures.push(item.title)

                if (!firstError) {
                    firstError = error instanceof Error ? error.message : '向量化失败'
                }
            }
        }

        vectorizing.value = false

        if (failures.length === items.value.length) {
            showError(firstError || '向量化失败')
        } else if (failures.length) {
            showToast(`已向量化 ${succeeded} 个,失败 ${failures.length} 个`, 'warning')
        } else {
            showToast(`已向量化 ${succeeded} 个知识库`, 'success')
        }
    }

    /** 暴露批量向量化能力:侧边栏按钮已移除,逻辑保留供后续入口调用 */
    defineExpose({ vectorizeAll: handleVectorizeAll })
</script>

<style scoped>
    .knowledge-panel-heading {
        flex: 1;
        min-width: 0;
    }

    .knowledge-panel-heading h3 {
        margin: 0 0 10px;
        color: #18181b;
        font-size: 14px;
        font-weight: 600;
    }

    .k-search {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .k-search > i {
        color: #9ca3af;
        font-size: 12px;
        flex: none;
    }

    .k-search input {
        flex: 1;
        min-width: 0;
        height: var(--gddp-control-height-compact);
        padding: 0 8px;
        border: 1px solid #dbe2ea;
        border-radius: var(--gddp-border-radius);
        outline: none;
        color: #111827;
        font-size: 12px;
        box-sizing: border-box;
        transition: border-color 0.15s ease;
    }

    .k-search input:focus {
        border-color: #111827;
    }

    .k-actions {
        display: flex;
        gap: 4px;
        align-self: flex-start;
        margin-top: 2px;
    }

    .k-actions :deep(.gddp-button:hover),
    .k-section-actions :deep(.gddp-button:hover) {
        background: #f4f4f5;
        color: #18181b;
    }

    .k-section-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .k-section-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }

    .k-count {
        padding: 1px 7px;
        border-radius: 999px;
        background: #ececee;
        color: #18181b;
        font-size: 11px;
        font-weight: 600;
    }

    .k-section-actions {
        display: inline-flex;
        align-items: center;
        gap: 2px;
    }

    .k-list {
        font-size: 13px;
        color: #444;
    }

    .k-list-empty {
        padding: 20px 0;
        color: #94a3b8;
        font-size: 12px;
        text-align: center;
    }

    .knowledge-item {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        padding: 9px 8px;
        border: 0;
        border-bottom: 1px solid #f1f5f9;
        background: transparent;
        color: #475569;
        text-align: left;
        font-size: 13px;
        cursor: pointer;
        box-sizing: border-box;
    }

    .knowledge-item > .fa-book {
        flex: none;
        color: #9ca3af;
        font-size: 13px;
    }

    .knowledge-item:hover {
        background: #f4f4f5;
        color: #18181b;
    }

    .knowledge-item.active {
        background: #ececee;
        color: #18181b;
        font-weight: 600;
    }

    .knowledge-item-title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .knowledge-item-pin {
        flex: none;
        color: #f59e0b;
        font-size: 11px;
    }
</style>