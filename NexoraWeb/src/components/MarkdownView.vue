<!--
    MarkdownView.vue — Markdown 渲染组件(对话与知识库共用)

    职责:
      - marked 渲染 Markdown → HTML
      - highlight.js 代码高亮
      - KaTeX 数学公式(块级 $$...$$ 与行内 $...$)
      - 输出前做基础 XSS 清洗(移除 script 与事件属性)
-->

<template>
    <div class="markdown-body" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    import { marked } from 'marked'
    import { markedHighlight } from 'marked-highlight'
    import hljs from 'highlight.js'
    import katex from 'katex'

    import 'highlight.js/styles/github.min.css'
    import 'katex/dist/katex.min.css'

    const props = defineProps<{
        content: string
    }>()

    /** 渲染配置:marked + marked-highlight 代码高亮 */
    marked.use(markedHighlight({
        langPrefix: 'hljs language-',

        highlight(code: string, lang: string): string {
            const language = hljs.getLanguage(lang) ? lang : 'plaintext'

            try {
                return hljs.highlight(code, { language }).value
            } catch {
                return hljs.highlightAuto(code).value
            }
        },
    }))

    /** 块级公式 $$...$$ 渲染为 HTML */
    function renderBlockMath(source: string): string {
        return source.replace(/\$\$([\s\S]+?)\$\$/g, (_match, latex: string) => {
            try {
                return katex.renderToString(latex.trim(), { displayMode: true, throwOnError: false })
            } catch {
                return `<code>$$${latex}$$</code>`
            }
        })
    }

    /** 行内公式 $...$ 渲染(前后不能是数字,避免与货币符号冲突) */
    function renderInlineMath(source: string): string {
        return source.replace(/(^|[^$\\])\$([^$\n]+?)\$/g, (_match, prefix: string, latex: string) => {
            try {
                return `${prefix}${katex.renderToString(latex.trim(), { displayMode: false, throwOnError: false })}`
            } catch {
                return _match
            }
        })
    }

    /** 基础 XSS 清洗:移除 script/iframe 标签与 on* 事件属性 */
    function sanitizeHtml(html: string): string {
        const template = document.createElement('template')

        template.innerHTML = html

        template.content.querySelectorAll('script, iframe, object, embed, link, meta').forEach((node) => node.remove())

        template.content.querySelectorAll('*').forEach((node) => {
            Array.from(node.attributes).forEach((attr) => {
                if (attr.name.startsWith('on')) {
                    node.removeAttribute(attr.name)
                }
            })
        })

        return template.innerHTML
    }

    const renderedHtml = computed(() => {
        const withMath = renderInlineMath(renderBlockMath(props.content || ''))

        const raw = marked.parse(withMath, { gfm: true, breaks: true }) as string

        return sanitizeHtml(raw)
    })
</script>

<style scoped>
    .markdown-body {
        line-height: 1.7;
        word-break: break-word;
        font-size: 14px;
    }

    .markdown-body :deep(p) {
        margin: 0.5em 0;
    }

    .markdown-body :deep(pre) {
        background: #f6f8fa;
        border-radius: 6px;
        padding: 12px;
        overflow-x: auto;
    }

    .markdown-body :deep(code) {
        font-family: 'Cascadia Code', Consolas, monospace;
        font-size: 13px;
    }

    .markdown-body :deep(:not(pre) > code) {
        background: rgba(175, 184, 193, 0.2);
        border-radius: 4px;
        padding: 0.1em 0.4em;
    }

    .markdown-body :deep(table) {
        border-collapse: collapse;
        margin: 0.5em 0;
    }

    .markdown-body :deep(th),
    .markdown-body :deep(td) {
        border: 1px solid #d0d7de;
        padding: 4px 10px;
    }

    .markdown-body :deep(blockquote) {
        border-left: 3px solid #d0d7de;
        margin: 0.5em 0;
        padding-left: 12px;
        color: #57606a;
    }

    .markdown-body :deep(img) {
        max-width: 100%;
    }
</style>
