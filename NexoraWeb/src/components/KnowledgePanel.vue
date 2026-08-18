<!--
    KnowledgePanel.vue — 原版 Nexora 知识库列表侧栏。

    侧栏只负责搜索、列表和入口,正文编辑器由主内容 KnowledgeViewer 承载,
    与原版 knowledgePanel / knowledgeViewer 的职责划分保持一致。
-->

<template>
    <aside ref="panelRef" class="knowledge-sidebar" id="knowledgePanel" :class="{ visible: open }">
        <div class="k-header">
            <div class="knowledge-panel-heading">
                <h3 style="margin-bottom: 6px;">Knowledge</h3>
                <div class="k-search" style="display:flex; gap:6px;">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <input
                        id="knowledgeSearchInput"
                        v-model="query"
                        type="search"
                        class="input-modern"
                        placeholder="搜索向量库..."
                        style="flex:1; font-size:12px; height:28px; padding:4px 8px;"
                        @keydown.enter="loadKnowledge"
                    >
                    <button id="knowledgeSearchBtn" class="btn-primary" type="button" style="padding:4px 10px; height:28px; background:#111; color:#fff; border:1px solid #111;" @click="loadKnowledge">搜索</button>
                </div>
            </div>
            <div class="k-actions" style="align-self:flex-start; margin-top:2px;">
            <button id="refreshKnowledgeBtn" class="btn-icon-small" type="button" title="Refresh" @click="loadKnowledge">
                <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
            </button>
            <button id="btnTogglePanel" class="btn-icon-small" type="button" title="Close" @click="emit('close')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            </div>
        </div>

        <div class="k-content">
            <div class="k-section">
                <div class="k-section-title">
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <div style="display:flex; align-items:center; gap:8px;"><span>BASIS</span><span id="panelBasisCount" class="badge">{{ filteredItems.length }}</span></div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <button id="createBlankBasisBtn" class="btn-primary" type="button" title="新建空白知识库" aria-label="新建空白知识库" style="width:24px; height:24px; padding:0; display:inline-flex; align-items:center; justify-content:center; background:transparent; color:#111; border:1px solid #cbd5e1; border-radius:50%;"><i class="fa-solid fa-plus" style="font-size:11px;"></i></button>
                            <button id="bulkVectorizeBtn" class="btn-primary" type="button" title="全部向量化" hidden style="width:24px; height:24px; padding:0; display:inline-flex; align-items:center; justify-content:center; background:transparent; color:#111; border:1px solid #cbd5e1; border-radius:50%;"><i class="fa-solid fa-arrows-rotate" style="font-size:11px;"></i></button>
                        </div>
                    </div>
                </div>
                <div id="panelBasisKnowledgeList" class="k-list">
                    <div v-if="loading" class="k-list-empty">加载中...</div>
                    <div v-else-if="!filteredItems.length" class="k-list-empty">暂无知识库</div>
                    <button v-for="item in filteredItems" :key="item.title" type="button" class="knowledge-item" :class="{ active: selectedTitle === item.title }" :title="item.title" @click="emit('open-document', item.title)">
                        <i class="fa-solid fa-book" aria-hidden="true"></i>
                        <span class="knowledge-item-title">{{ item.title }}</span>
                        <i v-if="item.pin" class="fa-solid fa-thumbtack" aria-hidden="true"></i>
                    </button>
                </div>
            </div>
        </div>
    </aside>
</template>

<script setup lang="ts">
    import { computed, onMounted, ref, watch } from 'vue'

    import { fetchKnowledgeSidebar, type KnowledgeItem } from '@/api/knowledge'
    import { showError } from '@/stores/notify'
    import { registerPanel } from '@/ui/overlay'

    const props = defineProps<{ open: boolean }>()
    const emit = defineEmits<{
        close: []
        'open-document': [title: string]
    }>()

    const query = ref('')
    const items = ref<KnowledgeItem[]>([])
    const selectedTitle = ref('')
    const loading = ref(false)
    const panelRef = ref<HTMLElement | null>(null)

    const filteredItems = computed(() => {
        const keyword = query.value.trim().toLowerCase()

        return items.value.filter((item) => !keyword || item.title.toLowerCase().includes(keyword))
    })

    onMounted(() => {
        registerPanel('knowledge', panelRef.value, [document.getElementById('toggleKnowledgePanel')])
    })

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
</script>

<style scoped media="not all">
    .knowledge-panel-heading {
        flex: 1;
        min-width: 0;
    }

    .knowledge-panel-heading h3 {
        margin: 0 0 8px;
    }

    .k-search {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .k-search input {
        flex: 1;
        min-width: 0;
        height: 30px;
        padding: 4px 8px;
        border: 1px solid #dbe2ea;
        border-radius: 7px;
        outline: 0;
        font-size: 12px;
    }

    .k-search button,
    .knowledge-panel-toolbar button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: 1px solid #dbe2ea;
        border-radius: 7px;
        background: #fff;
        color: #64748b;
        cursor: pointer;
    }

    .knowledge-panel-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 1px solid #eef2f7;
        color: #64748b;
        font-size: 11px;
        font-weight: 650;
    }

    .knowledge-panel-toolbar span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }

    .knowledge-panel-toolbar b {
        padding: 2px 6px;
        border-radius: 999px;
        background: #eef2ff;
        color: #4f46e5;
    }

    .knowledge-item {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        padding: 10px 14px;
        border: 0;
        border-bottom: 1px solid #f1f5f9;
        background: transparent;
        color: #475569;
        text-align: left;
        cursor: pointer;
    }

    .knowledge-item:hover,
    .knowledge-item.active {
        background: #f1f5ff;
        color: #3730a3;
    }

    .knowledge-item-title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .k-list-empty {
        padding: 20px 0;
        color: #94a3b8;
        font-size: 12px;
        text-align: center;
    }
</style>
