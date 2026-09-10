/**
 * exa-media.test.mjs — Exa 结果媒体归一化测试
 *
 * 验证结构化媒体、历史原始结果读取、图片过滤和旧 Markdown 图片清理。
 */

import assert from 'node:assert/strict'

import {
    readExaImageGallery,
    readExaImageGalleryFromResult,
    stripExaImageMarkdown,
} from '../src/stream/exaMedia.ts'

const structured = readExaImageGallery({
    type: 'exa_image_gallery',
    query: 'Nexora',
    items: [
        { image_url: 'https://cdn.example.com/one.jpg', title: '第一张', source_url: 'https://example.com/one' },
        { image_url: 'https://cdn.example.com/one.jpg', title: '重复图片', source_url: 'https://example.com/two' },
        { image_url: 'http://cdn.example.com/two.jpg', title: '不安全地址', source_url: 'https://example.com/three' },
    ],
})

assert.equal(structured.items.length, 1)
assert.equal(structured.items[0].imageUrl, 'https://cdn.example.com/one.jpg')

const legacy = readExaImageGalleryFromResult(JSON.stringify({
    success: true,
    query: 'Nexora',
    results: [{
        image: 'https://cdn.example.com/legacy.jpg',
        title: '历史图片',
        url: 'https://example.com/legacy',
    }],
}))

assert.equal(legacy.items[0].title, '历史图片')
assert.equal(legacy.items[0].sourceUrl, 'https://example.com/legacy')

const cleaned = stripExaImageMarkdown([
    '### Exa Web Search',
    '',
    '文字摘要',
    '',
    '![第一张](https://cdn.example.com/one.jpg)',
].join('\n'))

assert.equal(cleaned, '### Exa Web Search\n\n文字摘要')

console.log('Exa media tests passed')
