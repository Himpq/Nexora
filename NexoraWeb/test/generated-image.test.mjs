/**
 * generated-image.test.mjs — 生图工具结果图片归一化测试
 */

import assert from 'node:assert/strict'

import {
    isGenerateImageToolName,
    readGeneratedImageGallery,
} from '../src/stream/generatedImage.ts'

assert.equal(isGenerateImageToolName('generate_image'), true)
assert.equal(isGenerateImageToolName('generateImage'), true)
assert.equal(isGenerateImageToolName('web_search'), false)

const gallery = readGeneratedImageGallery('generate_image', JSON.stringify({
    success: true,
    images: [
        { index: 1, url: 'https://cdn.example.com/one.png' },
        { index: 2, url: 'https://cdn.example.com/one.png' },
        { index: 3, url: 'http://cdn.example.com/two.png' },
    ],
}))

assert.ok(gallery)
assert.equal(gallery.items.length, 1)
assert.equal(gallery.items[0].imageUrl, 'https://cdn.example.com/one.png')

const localGallery = readGeneratedImageGallery('generate_image', JSON.stringify({
    images: [{ asset_url: '/api/conversations/408/assets/abc123' }],
}))

assert.ok(localGallery)
assert.equal(localGallery.items[0].imageUrl, '/api/conversations/408/assets/abc123')

assert.equal(
    readGeneratedImageGallery('web_search', JSON.stringify({
        images: [{ url: 'https://cdn.example.com/search.png' }],
    })),
    undefined,
)

assert.equal(
    readGeneratedImageGallery('generate_image', 'not-json'),
    undefined,
)

console.log('Generated image tests passed')
