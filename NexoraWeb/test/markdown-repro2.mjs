import { marked } from 'marked'
import katex from 'katex'

marked.setOptions({ gfm: true, breaks: true })

// 完整模拟 MarkdownView 的两个预处理(真实 katex)
function renderBlockMath(source) {
    return source.replace(/\$\$([\s\S]+?)\$\$/g, (_match, latex) => {
        try {
            return katex.renderToString(latex.trim(), { displayMode: true, throwOnError: false })
        } catch {
            return `<code>$$${latex}$$</code>`
        }
    })
}

function renderInlineMath(source) {
    return source.replace(/(^|[^$\x5C])\$([^$\n]+?)\$/g, (_match, prefix, latex) => {
        try {
            return `${prefix}${katex.renderToString(latex.trim(), { displayMode: false, throwOnError: false })}`
        } catch {
            return _match
        }
    })
}

const cases = [
    '你好，**世界**！这是**测试**。',
    '价格 $5 和 **加粗** 并存',
    '**中文**：冒号后继续',
    '公式 $x^2$ 和 **加粗** 混排',
    '**加粗**。句号。**再粗**！',
    '行内 **code** `和代码` 与 **粗**。',
    '**a**$b$**c**',
    '中文全角，**重点**，**第二**。',
    '> 引用 **加粗** 和 **再粗**',
    '- 列表项 **加粗**\n- 第二项 **粗**',
]

for (const c of cases) {
    const withMath = renderInlineMath(renderBlockMath(c))
    const html = marked.parse(withMath)
    const strong = (html.match(/<strong>/g) || []).length
    const broken = html.includes('<strong') ? 'OK' : 'NO-STRONG'
    console.log(`${broken} strong=${strong} | ${JSON.stringify(c)} => ${html.slice(0, 120)}`)
}
