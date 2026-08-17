<!--
    KnowledgePanel.vue — 知识库右侧栏(逐像素复刻原版 knowledgePanel 结构)

    结构(与原版 chat.html #knowledgePanel 一致):
      aside.knowledge-sidebar > k-header(搜索) + k-content(BASIS 列表)
-->

<template>
    <aside ref="panelRef" class="knowledge-sidebar" id="knowledgePanel" :class="{ visible: open }">
        <div class="k-header">
            <div style="flex:1;">
                <h3 style="margin-bottom: 6px;">Knowledge Base</h3>
                <div class="k-search" style="display:flex; gap:6px;">
                    <input
                        v-model="query"
                        class="input-modern"
                        placeholder="搜索知识库..."
                        style="flex:1; font-size:12px; height: 28px; padding: 4px 8px;"
                        @keydown.enter="loadKnowledge"
                    />
                    <button
                        class="btn-primary btn-compact"
                        type="button"
                        @click="loadKnowledge"
                    >
                        搜索
                    </button>
                </div>
            </div>
            <div class="k-actions" style="align-self: flex-start; margin-top: 2px;">
                <button class="btn-icon-small" title="Close" @click="emit('close')">
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
                        <span>BASIS</span>
                        <span class="badge">{{ items.length }}</span>
                    </div>
                </div>
                <div class="k-list">
                    <div v-if="loading" class="k-list-empty">加载中...</div>
                    <div v-else-if="!items.length" class="k-list-empty">暂无知识库</div>
                    <div
                        v-for="item in items"
                        :key="item.title"
                        class="knowledge-item"
                        :title="item.title"
                    >
                        <i class="fa-solid fa-book" aria-hidden="true"></i>
                        <span class="knowledge-item-title">{{ item.title }}</span>
                    </div>
                </div>
            </div>
        </div>
    </aside>
</template>

<script setup lang="ts">
    import { onMounted, ref, watch } from 'vue'

    import { fetchKnowledgeSidebar, type KnowledgeItem } from '@/api/knowledge'
    import { showError } from '@/stores/notify'
    import { registerPanel } from '@/ui/overlay'

    const props = defineProps<{
        open: boolean
    }>()

    const emit = defineEmits<{
        close: []
    }>()

    const query = ref('')
    const items = ref<KnowledgeItem[]>([])
    const loading = ref(false)
    const panelRef = ref<HTMLElement | null>(null)

    /** 注册右侧栏到浮层协调器:点击外部自动关闭 */
    onMounted(() => {
        registerPanel('knowledge', panelRef.value, [
            document.getElementById('toggleKnowledgePanel'),
        ])
    })

    /** 面板打开时加载 */
    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                void loadKnowledge()
            }
        }
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

<style scoped>
    /*
     * 对齐原版:knowledge-item / k-list-empty 的样式全部来自原版 style.css,
     * 此处不覆盖任何原版规则,只补原版没有的最小空态样式。
     */

    .k-list-empty {
        color: #94a3b8;
        font-size: 12px;
        text-align: center;
        padding: 20px 0;
    }
</style>
