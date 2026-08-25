import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

// 模拟 MarkdownView.renderInlineMath 的正则
function renderInlineMath(source) {
    return source.replace(/(^|[^$\x5C])\$([^$\n]+?)\$/g, (_m, prefix, latex) => {
        return `${prefix}<span>MATH</span>`
    })
}

const cases = [
    '**加粗**：中文冒号后',
    '测试**加粗**和`代码`。',
    '**第一**。**第二**！',
    'a**b**c**d**e',
    '你好 **world** 世界。',
    '**粗体**与*斜体*混排',
    '中文**加粗**结尾。',
    '**开头加粗**中间**再粗**句号。',
]

for (const c of cases) {
    const withMath = renderInlineMath(c)
    const html = marked.parse(withMath)
    console.log(JSON.stringify(c), '=>', html)
}
