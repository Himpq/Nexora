<!--
    KnowledgeManagementView.vue — 知识库管理页面(迁移自原版 knowledge.html)

    职责:
      - 基础知识库:卡片网格增删改 + 公开协作分享 + 新建空白知识库
      - 短期记忆:用户画像记忆的查看 / 编辑 / 清空
      - 查看正文统一交给 KnowledgeViewer(emit open-document),避免重复编辑器
      - 视图切换由父级 ChatView 控制(替换主内容区)
-->

<template>
    <section class="knowledge-mgmt-view" aria-label="知识库管理">
        <div class="knowledge-mgmt-shell">
            <div class="knowledge-mgmt-head">
                <h1>知识库管理</h1>
                <div class="knowledge-mgmt-actions">
                    <button class="knowledge-mgmt-tool-btn" type="button" title="刷新" aria-label="刷新" @click="loadAll">
                        <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                    </button>
                    <button class="knowledge-mgmt-tool-btn" type="button" title="新建空白知识库" aria-label="新建空白知识库" @click="handleCreateBlank">
                        <i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i>
                    </button>
                    <button class="btn-primary" type="button" @click="openBasisModal(null)">
                        <i class="fa-solid fa-plus" aria-hidden="true"></i>
                        <span>添加知识</span>
                    </button>
                </div>
            </div>

            <div class="knowledge-mgmt-tabs" role="tablist" aria-label="知识库分类">
                <button
                    class="knowledge-mgmt-tab"
                    :class="{ active: tab === 'basis' }"
                    type="button"
                    role="tab"
                    :aria-selected="tab === 'basis'"
                    @click="tab = 'basis'"
                >基础知识库</button>
                <button
                    class="knowledge-mgmt-tab"
                    :class="{ active: tab === 'short' }"
                    type="button"
                    role="tab"
                    :aria-selected="tab === 'short'"
                    @click="tab = 'short'"
                >短期记忆</button>
            </div>

            <!-- 基础知识库 -->
            <div v-show="tab === 'basis'" class="knowledge-mgmt-basis">
                <div class="knowledge-mgmt-section-head">
                    <h2>基础知识库</h2>
                </div>

                <div v-if="basisLoading" class="knowledge-mgmt-grid" aria-hidden="true">
                    <div v-for="i in 6" :key="i" class="knowledge-mgmt-card knowledge-mgmt-skeleton">
                        <div class="knowledge-mgmt-skeleton-ico"></div>
                        <div class="knowledge-mgmt-skeleton-body">
                            <div class="knowledge-mgmt-skeleton-line knowledge-mgmt-skeleton-title"></div>
                            <div class="knowledge-mgmt-skeleton-line knowledge-mgmt-skeleton-short"></div>
                        </div>
                    </div>
                </div>

                <div v-else-if="!basisItems.length" class="knowledge-mgmt-empty">
                    <i class="fa-regular fa-folder-open" aria-hidden="true"></i>
                    <p>暂无基础知识，点击右上角「添加知识」创建</p>
                </div>

                <div v-else class="knowledge-mgmt-grid">
                    <article
                        v-for="item in basisItems"
                        :key="item.title"
                        class="knowledge-mgmt-card"
                        role="button"
                        tabindex="0"
                        :title="item.title"
                        @click="emit('open-document', item.title)"
                        @keydown.enter="emit('open-document', item.title)"
                    >
                        <div class="knowledge-mgmt-card-main">
                            <i class="fa-regular fa-file-lines" aria-hidden="true"></i>
                            <div class="knowledge-mgmt-card-info">
                                <div class="knowledge-mgmt-card-head">
                                    <h3>{{ item.title }}</h3>
                                    <span v-if="item.public" class="knowledge-mgmt-card-badge" title="公开协作">公开</span>
                                    <i v-if="item.pin" class="fa-solid fa-thumbtack" aria-hidden="true" title="已置顶"></i>
                                </div>
                                <p class="knowledge-mgmt-card-updated">
                                    <i class="fa-regular fa-clock" aria-hidden="true"></i>
                                    {{ formatUpdatedAt(item.updated_at) }}
                                </p>
                            </div>
                        </div>
                        <div class="knowledge-mgmt-card-actions" @click.stop>
                            <button type="button" class="knowledge-mgmt-card-btn" title="查看" @click="emit('open-document', item.title)">
                                <i class="fa-regular fa-eye" aria-hidden="true"></i>
                            </button>
                            <button type="button" class="knowledge-mgmt-card-btn" title="编辑" @click="openBasisModal(item)">
                                <i class="fa-regular fa-pen-to-square" aria-hidden="true"></i>
                            </button>
                            <button type="button" class="knowledge-mgmt-card-btn knowledge-mgmt-card-btn-danger" title="删除" @click="handleDeleteBasis(item)">
                                <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
                            </button>
                        </div>
                    </article>
                </div>
            </div>

            <!-- 短期记忆 -->
            <div v-show="tab === 'short'" class="knowledge-mgmt-short">
                <div class="knowledge-mgmt-section-head">
                    <h2>短期记忆</h2>
                    <button class="btn-primary" type="button" @click="openShortModal(null)">
                        <i class="fa-solid fa-plus" aria-hidden="true"></i>
                        <span>添加记忆</span>
                    </button>
                </div>

                <div v-if="shortLoading" class="knowledge-mgmt-empty">加载中...</div>

                <div v-else-if="!shortItems.length" class="knowledge-mgmt-empty">
                    <i class="fa-regular fa-note-sticky" aria-hidden="true"></i>
                    <p>暂无短期记忆</p>
                </div>

                <div v-else class="knowledge-mgmt-short-list">
                    <article v-for="item in shortItems" :key="item.id" class="knowledge-mgmt-short-item">
                        <div class="knowledge-mgmt-short-body">
                            <strong>{{ item.title }}</strong>
                            <p>{{ item.content }}</p>
                        </div>
                        <div class="knowledge-mgmt-short-actions">
                            <button type="button" class="knowledge-mgmt-card-btn" title="编辑" @click="openShortModal(item)">
                                <i class="fa-regular fa-pen-to-square" aria-hidden="true"></i>
                            </button>
                            <button type="button" class="knowledge-mgmt-card-btn knowledge-mgmt-card-btn-danger" title="删除" @click="handleDeleteShort(item)">
                                <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
                            </button>
                        </div>
                    </article>
                </div>
            </div>
        </div>

        <!-- 添加/编辑基础知识模态框 -->
        <div v-if="basisModalOpen" class="knowledge-mgmt-backdrop" @mousedown.self="closeModals">
            <div class="knowledge-mgmt-modal" role="dialog" aria-modal="true">
                <div class="knowledge-mgmt-modal-head">
                    <h3>{{ basisModalTitle ? '编辑基础知识' : '添加基础知识' }}</h3>
                    <button class="knowledge-mgmt-modal-close" type="button" aria-label="关闭" @click="closeModals">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                <form class="knowledge-mgmt-modal-body" @submit.prevent="handleSubmitBasis">
                    <div class="knowledge-mgmt-form-group">
                        <label>标题</label>
                        <input v-model="basisForm.title" type="text" placeholder="输入知识标题" required>
                    </div>

                    <div class="knowledge-mgmt-form-group">
                        <label>内容</label>
                        <textarea v-model="basisForm.content" rows="10" placeholder="输入知识内容" required></textarea>
                    </div>

                    <div class="knowledge-mgmt-form-group">
                        <label>来源 URL（可选）</label>
                        <input v-model="basisForm.url" type="url" placeholder="https://...">
                    </div>

                    <div v-if="basisShareUrl" class="knowledge-mgmt-share-info">
                        <strong>公开分享预览:</strong>
                        <a :href="basisShareUrl" target="_blank" rel="noopener noreferrer">{{ basisShareUrl }}</a>
                    </div>

                    <div class="knowledge-mgmt-modal-footer">
                        <button
                            v-if="basisModalTitle"
                            type="button"
                            class="btn-primary-outline btn-compact"
                            :class="{ 'is-active': basisForm.public }"
                            @click="handleTogglePublicInModal"
                        >{{ basisForm.public ? '关闭公开协作' : '开启公开协作' }}</button>
                        <button type="button" class="btn-cancel" @click="closeModals">取消</button>
                        <button type="submit" class="btn-primary">{{ basisModalTitle ? '保存' : '添加' }}</button>
                    </div>
                </form>
            </div>
        </div>

        <!-- 添加/编辑短期记忆模态框 -->
        <div v-if="shortModalOpen" class="knowledge-mgmt-backdrop" @mousedown.self="closeModals">
            <div class="knowledge-mgmt-modal" role="dialog" aria-modal="true">
                <div class="knowledge-mgmt-modal-head">
                    <h3>{{ shortModalTitle ? '编辑短期记忆' : '添加短期记忆' }}</h3>
                    <button class="knowledge-mgmt-modal-close" type="button" aria-label="关闭" @click="closeModals">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>

                <form class="knowledge-mgmt-modal-body" @submit.prevent="handleSubmitShort">
                    <div class="knowledge-mgmt-form-group">
                        <label>标题</label>
                        <input v-model="shortForm.title" type="text" placeholder="输入记忆标题" required>
                    </div>

                    <div class="knowledge-mgmt-form-group">
                        <label>内容</label>
                        <textarea v-model="shortForm.content" rows="6" placeholder="输入记忆内容" required></textarea>
                    </div>

                    <div class="knowledge-mgmt-modal-footer">
                        <button type="button" class="btn-cancel" @click="closeModals">取消</button>
                        <button type="submit" class="btn-primary">{{ shortModalTitle ? '保存' : '添加' }}</button>
                    </div>
                </form>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
    import { onMounted, ref, watch } from 'vue'

    import {
        createBasisKnowledge,
        createBlankBasis,
        createShortMemory,
        deleteBasisKnowledge,
        deleteShortMemory,
        fetchKnowledgeContent,
        fetchKnowledgeList,
        fetchShortMemoryList,
        setBasisPublic,
        updateBasisKnowledge,
        updateShortMemory,
        type BasisKnowledgeItem,
        type ShortMemoryItem,
    } from '@/api/knowledge'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'

    const props = defineProps<{ open: boolean }>()

    const emit = defineEmits<{
        close: []
        'open-document': [title: string]
    }>()

    /** 当前激活的分类标签 */
    const tab = ref<'basis' | 'short'>('basis')

    /** 基础知识库列表 */
    const basisItems = ref<BasisKnowledgeItem[]>([])
    const basisLoading = ref(false)

    /** 短期记忆列表 */
    const shortItems = ref<ShortMemoryItem[]>([])
    const shortLoading = ref(false)

    /** 基础知识表单状态;basisModalTitle 非空表示编辑已有知识 */
    const basisModalOpen = ref(false)
    const basisModalTitle = ref('')
    const basisShareUrl = ref('')
    const basisForm = ref({ title: '', content: '', url: '', public: false })

    /** 短期记忆表单状态;shortModalTitle 非空表示编辑已有记忆 */
    const shortModalOpen = ref(false)
    const shortModalTitle = ref('')
    const shortForm = ref({ title: '', content: '' })

    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                void loadAll()
            }
        }
    )

    onMounted(() => {
        if (props.open) {
            void loadAll()
        }
    })

    /** 一次性加载基础知识库与短期记忆(任一失败互不影响) */
    async function loadAll(): Promise<void> {
        await Promise.all([loadBasisKnowledge(), loadShortMemory()])
    }

    /** 加载基础知识库列表 */
    async function loadBasisKnowledge(): Promise<void> {
        basisLoading.value = true

        try {
            basisItems.value = await fetchKnowledgeList()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载基础知识失败')
        } finally {
            basisLoading.value = false
        }
    }

    /** 加载短期记忆列表 */
    async function loadShortMemory(): Promise<void> {
        shortLoading.value = true

        try {
            shortItems.value = await fetchShortMemoryList()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载短期记忆失败')
        } finally {
            shortLoading.value = false
        }
    }

    /** 打开基础知识库添加/编辑模态框;编辑时拉取正文与元数据(列表接口不含正文) */
    async function openBasisModal(item: BasisKnowledgeItem | null): Promise<void> {
        basisModalTitle.value = item ? item.title : ''
        basisShareUrl.value = ''
        basisForm.value = {
            title: item ? item.title : '',
            content: '',
            url: '',
            public: false,
        }

        if (item) {
            try {
                const data = await fetchKnowledgeContent(item.title)
                const metadata = (data.metadata || {}) as Record<string, unknown>

                basisForm.value.content = data.content || ''
                basisForm.value.public = Boolean(metadata.public)
            } catch (error) {
                showError(error instanceof Error ? error.message : '加载知识内容失败')
            }
        }

        basisModalOpen.value = true
    }

    /** 提交基础知识库表单(新增走 POST,编辑走 PUT) */
    async function handleSubmitBasis(): Promise<void> {
        const title = basisForm.value.title.trim()
        const content = basisForm.value.content.trim()

        if (!title || !content) {
            showToast('请填写完整信息', 'warning')

            return
        }

        const payload = { title, content, url: basisForm.value.url.trim() }

        try {
            if (basisModalTitle.value) {
                await updateBasisKnowledge(basisModalTitle.value, payload)
                showToast('保存成功', 'success')
            } else {
                await createBasisKnowledge(payload)
                showToast('添加成功', 'success')
            }

            closeModals()
            await loadBasisKnowledge()
        } catch (error) {
            showError(error instanceof Error ? error.message : '提交失败')
        }
    }

    /** 编辑模态框内切换公开协作:切换该条知识的公开状态并展示分享链接 */
    async function handleTogglePublicInModal(): Promise<void> {
        if (!basisModalTitle.value) {
            showToast('请先保存后再开启分享', 'warning')

            return
        }

        try {
            basisShareUrl.value = await setBasisPublic(basisModalTitle.value, !basisForm.value.public)
            basisForm.value.public = !basisForm.value.public

            showToast(basisForm.value.public ? '公开协作已开启' : '公开协作已关闭', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '操作失败')
        }
    }

    /** 删除基础知识(确认后删除并刷新列表) */
    async function handleDeleteBasis(item: BasisKnowledgeItem): Promise<void> {
        const confirmed = await showConfirm({
            title: '删除知识',
            content: `确定要删除「${item.title}」吗？此操作不可恢复。`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await deleteBasisKnowledge(item.title)
            showToast('删除成功', 'success')
            await loadBasisKnowledge()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 新建空白知识库:输入前缀后创建并打开编辑器 */
    async function handleCreateBlank(): Promise<void> {
        try {
            const title = await createBlankBasis()

            showToast('空白知识库已创建', 'success')
            await loadBasisKnowledge()
            emit('open-document', title)
        } catch (error) {
            showError(error instanceof Error ? error.message : '创建空白知识库失败')
        }
    }

    /** 打开短期记忆添加/编辑模态框 */
    function openShortModal(item: ShortMemoryItem | null): void {
        shortModalTitle.value = item ? item.title : ''
        shortForm.value = {
            title: item ? item.title : '',
            content: item ? item.content : '',
        }
        shortModalOpen.value = true
    }

    /** 提交短期记忆表单(新增走 POST,编辑走 PUT) */
    async function handleSubmitShort(): Promise<void> {
        const title = shortForm.value.title.trim()
        const content = shortForm.value.content.trim()

        if (!title || !content) {
            showToast('请填写完整信息', 'warning')

            return
        }

        try {
            if (shortModalTitle.value) {
                await updateShortMemory(shortModalTitle.value, content)
                showToast('保存成功', 'success')
            } else {
                await createShortMemory(title, content)
                showToast('添加成功', 'success')
            }

            closeModals()
            await loadShortMemory()
        } catch (error) {
            showError(error instanceof Error ? error.message : '提交失败')
        }
    }

    /** 删除短期记忆(确认后删除并刷新列表) */
    async function handleDeleteShort(item: ShortMemoryItem): Promise<void> {
        const confirmed = await showConfirm({
            title: '删除记忆',
            content: `确定要删除「${item.title}」吗？此操作不可恢复。`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })

        if (!confirmed) {
            return
        }

        try {
            await deleteShortMemory(item.title)
            showToast('删除成功', 'success')
            await loadShortMemory()
        } catch (error) {
            showError(error instanceof Error ? error.message : '删除失败')
        }
    }

    /** 关闭全部模态框 */
    function closeModals(): void {
        basisModalOpen.value = false
        shortModalOpen.value = false
    }

    /** 格式化更新时间:秒级时间戳或时间字符串统一转为本地时间文本 */
    function formatUpdatedAt(raw: string | number | undefined): string {
        const ts = Number(raw)

        if (Number.isFinite(ts) && ts > 0) {
            return new Date(ts * 1000).toLocaleString()
        }

        const parsed = new Date(String(raw || ''))

        return Number.isNaN(parsed.getTime()) ? '未记录更新时间' : parsed.toLocaleString()
    }
</script>

<style scoped>
    .knowledge-mgmt-view {
        flex: 1;
        min-height: 0;
        overflow: auto;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        box-sizing: border-box;
        padding: 42px 40px 58px;
    }

    .knowledge-mgmt-shell {
        width: 100%;
        max-width: 900px;
        min-height: 100%;
        margin: 0 auto;
        padding: 0;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
    }

    .knowledge-mgmt-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 30px;
    }

    .knowledge-mgmt-head h1 {
        margin: 0;
        color: var(--color-text-primary);
        font-size: 28px;
        line-height: 1.2;
        font-weight: 650;
        letter-spacing: 0;
    }

    .knowledge-mgmt-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .knowledge-mgmt-tool-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: var(--gddp-control-height);
        padding: 0;
        border: 1px solid var(--color-border);
        border-radius: var(--gddp-border-radius);
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        font-size: 14px;
        cursor: pointer;
        transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
    }

    .knowledge-mgmt-tool-btn:hover {
        border-color: var(--color-text-primary);
        color: var(--color-text-primary);
        background: var(--color-bg-sunken);
    }

    .knowledge-mgmt-tabs {
        display: flex;
        gap: 8px;
        margin-bottom: 24px;
        border-bottom: 1px solid var(--color-border);
    }

    .knowledge-mgmt-tab {
        padding: 10px 16px;
        border: none;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        background: transparent;
        color: var(--color-text-secondary);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: color 0.15s ease;
    }

    .knowledge-mgmt-tab:hover {
        color: var(--color-text-primary);
    }

    .knowledge-mgmt-tab.active {
        color: var(--color-text-primary);
        border-bottom-color: var(--color-text-primary);
    }

    .knowledge-mgmt-section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
    }

    .knowledge-mgmt-section-head h2 {
        margin: 0;
        color: var(--color-text-primary);
        font-size: 16px;
        font-weight: 600;
    }

    .knowledge-mgmt-grid {
        display: flex;
        flex-direction: column;
        border-top: 1px solid var(--color-border);
    }

    .knowledge-mgmt-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 12px;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-bg-elevated);
        cursor: pointer;
        transition: background-color 0.12s ease;
    }

    .knowledge-mgmt-card:hover {
        background: var(--color-bg-sunken);
    }

    .knowledge-mgmt-card-main {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
    }

    .knowledge-mgmt-card-main > .fa-file-lines {
        flex: none;
        color: var(--color-text-secondary);
        font-size: 15px;
    }

    .knowledge-mgmt-card-info {
        flex: 1;
        min-width: 0;
    }

    .knowledge-mgmt-card-head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
    }

    .knowledge-mgmt-card-badge {
        flex: none;
        padding: 1px 7px;
        border: 1px solid #d4d4d8;
        border-radius: 999px;
        color: var(--color-text-secondary);
        font-size: 11px;
        line-height: 1.4;
    }

    .knowledge-mgmt-card-head h3 {
        flex: 1;
        min-width: 0;
        margin: 0;
        overflow: hidden;
        color: var(--color-text-primary);
        font-size: 14px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .knowledge-mgmt-card-head .fa-thumbtack {
        color: #f59e0b;
        font-size: 12px;
    }

    .knowledge-mgmt-card-updated {
        margin: 0;
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    .knowledge-mgmt-card-updated i {
        margin-right: 4px;
    }

    .knowledge-mgmt-card-actions {
        display: flex;
        flex: none;
        gap: 8px;
        opacity: 1;
        transition: opacity 0.2s;
    }

    /* 触屏设备操作按钮始终可见;桌面端 hover 卡片时才浮现 */
    @media (hover: hover) {
        .knowledge-mgmt-card-actions {
            opacity: 0;
        }

        .knowledge-mgmt-card:hover .knowledge-mgmt-card-actions {
            opacity: 1;
        }
    }

    .knowledge-mgmt-card-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        font-size: 12px;
        cursor: pointer;
        transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
    }

    .knowledge-mgmt-card-btn:hover {
        border-color: var(--color-text-primary);
        color: var(--color-text-primary);
        background: var(--color-bg-hover);
    }

    .knowledge-mgmt-card-btn-danger:hover {
        border-color: var(--color-danger-border);
        color: var(--color-danger-text);
        background: #fef2f2;
    }

    .knowledge-mgmt-empty {
        padding: 60px 20px;
        color: var(--color-text-secondary);
        font-size: 14px;
        text-align: center;
    }

    .knowledge-mgmt-empty i {
        display: block;
        margin-bottom: 12px;
        font-size: 44px;
        opacity: 0.4;
    }

    .knowledge-mgmt-empty p {
        margin: 0;
    }

    .knowledge-mgmt-short-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .knowledge-mgmt-short-item {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 16px 20px;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg-elevated);
    }

    .knowledge-mgmt-short-body {
        flex: 1;
        min-width: 0;
    }

    .knowledge-mgmt-short-body strong {
        display: block;
        margin-bottom: 6px;
        color: var(--color-text-primary);
        font-size: 14px;
    }

    .knowledge-mgmt-short-body p {
        margin: 0;
        color: var(--color-text-secondary);
        font-size: 13px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .knowledge-mgmt-short-actions {
        display: flex;
        gap: 8px;
    }

    .knowledge-mgmt-skeleton {
        cursor: default;
        pointer-events: none;
    }

    .knowledge-mgmt-skeleton-ico {
        flex: none;
        width: 22px;
        height: 22px;
        border-radius: 6px;
        background: linear-gradient(90deg, var(--color-bg-hover) 0%, var(--color-bg-sunken) 46%, var(--color-bg-hover) 100%);
        background-size: 220% 100%;
        animation: knowledge-mgmt-skeleton 1.1s ease-in-out infinite;
    }

    .knowledge-mgmt-skeleton-body {
        flex: 1;
        min-width: 0;
    }

    .knowledge-mgmt-skeleton-line {
        height: 12px;
        margin-bottom: 8px;
        border-radius: 6px;
        background: linear-gradient(90deg, var(--color-bg-hover) 0%, var(--color-bg-sunken) 46%, var(--color-bg-hover) 100%);
        background-size: 220% 100%;
        animation: knowledge-mgmt-skeleton 1.1s ease-in-out infinite;
    }

    .knowledge-mgmt-skeleton-title {
        width: 44%;
        height: 14px;
    }

    .knowledge-mgmt-skeleton-short {
        width: 72%;
        margin-bottom: 0;
    }

    @keyframes knowledge-mgmt-skeleton {
        0% {
            background-position: 100% 0;
        }

        100% {
            background-position: -120% 0;
        }
    }

    .knowledge-mgmt-backdrop {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: var(--z-modal);
        background: rgba(15, 23, 42, 0.4);
    }

    .knowledge-mgmt-modal {
        width: 90%;
        max-width: 560px;
        max-height: 88vh;
        overflow-y: auto;
        border-radius: 12px;
        background: var(--color-bg-elevated);
        box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
        animation: knowledge-mgmt-slide-up 0.2s ease;
    }

    @keyframes knowledge-mgmt-slide-up {
        from {
            transform: translateY(24px);
            opacity: 0;
        }

        to {
            transform: translateY(0);
            opacity: 1;
        }
    }

    .knowledge-mgmt-modal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--color-border);
    }

    .knowledge-mgmt-modal-head h3 {
        margin: 0;
        color: var(--color-text-primary);
        font-size: 16px;
    }

    .knowledge-mgmt-modal-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
    }

    .knowledge-mgmt-modal-close:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    .knowledge-mgmt-modal-body {
        padding: 20px;
    }

    .knowledge-mgmt-form-group {
        margin-bottom: 16px;
    }

    .knowledge-mgmt-form-group label {
        display: block;
        margin-bottom: 6px;
        color: var(--color-text-secondary);
        font-size: 13px;
        font-weight: 500;
    }

    .knowledge-mgmt-form-group input,
    .knowledge-mgmt-form-group textarea {
        width: 100%;
        padding: 9px 12px;
        border: 1px solid var(--color-border);
        border-radius: 7px;
        outline: none;
        color: var(--color-text-primary);
        font-family: inherit;
        font-size: 13px;
        box-sizing: border-box;
        transition: border-color 0.2s;
    }

    .knowledge-mgmt-form-group input:focus,
    .knowledge-mgmt-form-group textarea:focus {
        border-color: var(--color-text-primary);
    }

    .knowledge-mgmt-form-group textarea {
        resize: vertical;
    }

    .knowledge-mgmt-share-info {
        margin-bottom: 16px;
        padding: 10px 12px;
        border: 1px solid #bae6fd;
        border-radius: 8px;
        background: #f0f9ff;
        font-size: 13px;
    }

    .knowledge-mgmt-share-info strong {
        display: block;
        margin-bottom: 4px;
        color: #075985;
    }

    .knowledge-mgmt-share-info a {
        color: #0284c7;
        word-break: break-all;
    }

    .knowledge-mgmt-modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 20px;
    }

    /* 公开协作开关的激活态(覆盖 GDDP btn-primary-outline hover 行为) */
    .knowledge-mgmt-modal-footer .btn-primary-outline.is-active {
        border-color: var(--color-text-primary);
        color: var(--color-text-primary);
        background: var(--color-control-active);
    }

    /* 移动端:压缩页面留白,卡片单列展示 */
    @media (max-width: 760px) {
        .knowledge-mgmt-view {
            padding: 24px 16px 40px;
        }

        .knowledge-mgmt-head h1 {
            font-size: 22px;
        }

        .knowledge-mgmt-card {
            padding: 12px 8px;
        }
    }
</style>
