<!--
    KnowledgeViewer.vue — 知识库正文视图(宿主层)

    职责:
      - 加载知识正文并交给 GDDP MarkdownEditor 组件渲染/编辑
      - 图片上传(知识库 API:allocate → upload → 占位替换)
      - 保存与向量化由顶栏按钮经 ref 调用
    编辑器内核、工具栏、视图模式、全屏、布局修正均由 MarkdownEditor 自包含管理
-->

<template>
    <section class="knowledge-viewer">
        <MarkdownEditor
            v-if="ready"
            ref="editorRef"
            :key="props.title"
            :initial-value="content"
            placeholder="开始编写知识库正文…"
            @image-files="handleImageFiles"
        />
    </section>
</template>

<script setup lang="ts">
    import { ref, watch } from 'vue'

    import MarkdownEditor from '@/ui/editor/MarkdownEditor.vue'
    import {
        fetchKnowledgeContent,
        saveKnowledgeContent,
        uploadKnowledgeImage,
        vectorizeKnowledge,
        type KnowledgeContent,
    } from '@/api/knowledge'
    import { showError, showToast } from '@/stores/notify'

    const props = defineProps<{
        open: boolean
        title: string
    }>()

    const editorRef = ref<InstanceType<typeof MarkdownEditor> | null>(null)
    const version = ref<Partial<KnowledgeContent>>({})
    const loading = ref(false)
    const ready = ref(false)
    const content = ref('')

    watch(
        () => [props.open, props.title] as const,
        ([opened, title]) => {
            ready.value = false
            content.value = ''

            if (opened && title) {
                void load(title)
            }
        },
        { immediate: true }
    )

    /** 加载知识正文(就绪后渲染编辑器) */
    async function load(title: string): Promise<void> {
        loading.value = true

        try {
            const data = await fetchKnowledgeContent(title)

            version.value = data
            content.value = data.content ?? ''
            ready.value = true
        } catch (error) {
            showError(error instanceof Error ? error.message : '读取知识库失败')
        } finally {
            loading.value = false
        }
    }

    /** 上传单张图片:插入占位 markdown,上传成功后替换为真实地址 */
    async function uploadImage(file: File): Promise<void> {
        if (!editorRef.value || !props.title) {
            return
        }

        const fileName = file.name || 'image'
        const placeholder = `![${fileName}](uploading)`

        editorRef.value.replaceSelection(`\n${placeholder}\n`)

        try {
            const url = await uploadKnowledgeImage(file, props.title)

            replacePlaceholderInMarkdown(placeholder, `![${fileName}](${url})`)
            showToast(`图片已上传：${fileName}`, 'success')
        } catch (error) {
            replacePlaceholderInMarkdown(placeholder, `![${fileName}](上传失败)`)
            showError(error instanceof Error ? error.message : '图片上传失败')
        }
    }

    /** 用真实 markdown 替换编辑器内的占位文本 */
    function replacePlaceholderInMarkdown(placeholder: string, replacement: string): void {
        if (!editorRef.value) {
            return
        }

        const markdown = editorRef.value.getMarkdown()

        editorRef.value.setMarkdown(markdown.replace(placeholder, replacement))
    }

    /** 编辑器图片事件(按钮选择 / 粘贴 / 拖拽)统一入口 */
    async function handleImageFiles(files: File[]): Promise<void> {
        for (const file of files) {
            await uploadImage(file)
        }
    }

    /** 保存正文 */
    async function save(): Promise<void> {
        if (!editorRef.value || !props.title) {
            return
        }

        try {
            version.value = await saveKnowledgeContent(props.title, editorRef.value.getMarkdown(), version.value)
            showToast('知识库已保存', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '保存知识库失败')
        }
    }

    /** 向量化当前正文 */
    async function vectorize(): Promise<void> {
        if (!editorRef.value || !props.title) {
            return
        }

        try {
            await vectorizeKnowledge(props.title, editorRef.value.getMarkdown())
            showToast('知识库向量化完成', 'success')
        } catch (error) {
            showError(error instanceof Error ? error.message : '知识库向量化失败')
        }
    }

    defineExpose({ save, vectorize, loading })
</script>

<style scoped>
    .knowledge-viewer {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        background: #fff;
    }
</style>