/**
 * chat_image_viewer.js — 图片查看器（ImageViewer）
 *
 * 职责：大图查看 / 缩放 / 平移 / 拖拽 / 滚轮缩放 / 键盘操作；从 chat.js 批量迁移。
 * 状态收敛于模块内 imageViewerState，DOM 元素按需获取，不依赖 chat.js 的 els。
 *
 * 对外 window 桥接清单：
 *   - 无（openImageViewer 供 chat.js deps 注入，bindImageViewerEvents 供 chat_app.js 调用）
 *
 * 依赖 store 子域：
 *   - 无（纯 DOM/canvas 操作）
 *
 * 设计形态：函数式（状态收敛于模块内 imageViewerState 对象）
 */
const imageViewerState = {
    active: false,
    scale: 1,
    minScale: 0.2,
    maxScale: 6,
    tx: 0,
    ty: 0,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    pointerId: null,
    renderRaf: 0,
    scaleLabelDirty: true,
    lastScaleLabel: ''
};


/**
 * 获取图片查看器 DOM 元素（模块内按需获取，与 chat.js 的 els 解耦）。
 *
 * @returns {Object} 图片查看器相关 DOM 引用
 */
function getImageViewerElements() {
    return {
        backdrop: document.getElementById('imageViewerBackdrop'),
        viewport: document.getElementById('imageViewerViewport'),
        image: document.getElementById('imageViewerImage'),
        close: document.getElementById('imageViewerClose'),
        zoomIn: document.getElementById('imageViewerZoomIn'),
        zoomOut: document.getElementById('imageViewerZoomOut'),
        reset: document.getElementById('imageViewerReset'),
        scaleLabel: document.getElementById('imageViewerScaleLabel'),
    };
}


/**
 * 将缩放值限制在允许范围内。
 *
 * @param {number} v - 目标缩放值
 * @returns {number} 受限后的缩放值
 */
function clampImageViewerScale(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.min(imageViewerState.maxScale, Math.max(imageViewerState.minScale, n));
}


/**
 * 释放指针捕获。
 *
 * @param {number} pointerId - 指针 ID
 */
function releaseImageViewerPointerCapture(pointerId = imageViewerState.pointerId) {
    const viewport = getImageViewerElements().viewport;
    if (!viewport || pointerId === null || pointerId === undefined) {
        return;
    }

    try {
        viewport.releasePointerCapture(pointerId);
    } catch (_) {}
}


/**
 * 更新缩放百分比标签。
 */
function updateImageViewerScaleLabel() {
    const scaleLabel = getImageViewerElements().scaleLabel;
    if (scaleLabel) {
        const nextLabel = `${Math.round(imageViewerState.scale * 100)}%`;

        if (imageViewerState.lastScaleLabel !== nextLabel) {
            imageViewerState.lastScaleLabel = nextLabel;
            scaleLabel.textContent = nextLabel;
        }
    }
}


/**
 * 将当前 transform 一次性写入 DOM。
 */
function flushImageViewerTransform() {
    imageViewerState.renderRaf = 0;
    const image = getImageViewerElements().image;

    if (image) {
        image.style.transform = `translate3d(${imageViewerState.tx}px, ${imageViewerState.ty}px, 0) scale(${imageViewerState.scale})`;
    }

    if (imageViewerState.scaleLabelDirty) {
        imageViewerState.scaleLabelDirty = false;
        updateImageViewerScaleLabel();
    }
}


/**
 * 调度一次 transform 刷新（rAF 合并）。
 *
 * @param {boolean} updateScaleLabel - 是否同时刷新缩放标签
 */
function scheduleImageViewerTransform(updateScaleLabel = false) {
    if (updateScaleLabel) {
        imageViewerState.scaleLabelDirty = true;
    }

    if (imageViewerState.renderRaf) {
        return;
    }

    imageViewerState.renderRaf = requestAnimationFrame(flushImageViewerTransform);
}


/**
 * 应用图片变换（拖拽/缩放）。
 *
 * @param {boolean} updateScaleLabel - 是否同时刷新缩放标签
 */
function applyImageViewerTransform(updateScaleLabel = false) {
    scheduleImageViewerTransform(updateScaleLabel);
}


/**
 * 取消已调度的 transform 刷新。
 */
function cancelImageViewerTransformFrame() {
    if (!imageViewerState.renderRaf) {
        return;
    }

    cancelAnimationFrame(imageViewerState.renderRaf);
    imageViewerState.renderRaf = 0;
}


/**
 * 重置缩放/平移。
 *
 * @param {Object} options - 选项（immediate: 是否立即生效而非 rAF 合并）
 */
function resetImageViewerTransform(options = {}) {
    const immediate = !!(options && options.immediate);
    releaseImageViewerPointerCapture();
    imageViewerState.scale = 1;
    imageViewerState.tx = 0;
    imageViewerState.ty = 0;
    imageViewerState.dragging = false;
    imageViewerState.pointerId = null;
    const viewport = getImageViewerElements().viewport;
    if (viewport) {
        viewport.classList.remove('dragging');
    }

    imageViewerState.scaleLabelDirty = true;

    if (immediate) {
        cancelImageViewerTransformFrame();
        flushImageViewerTransform();
        return;
    }

    applyImageViewerTransform(true);
}


/**
 * 关闭图片查看器。
 */
function closeImageViewer() {
    cancelImageViewerTransformFrame();
    releaseImageViewerPointerCapture();
    imageViewerState.active = false;
    imageViewerState.dragging = false;
    imageViewerState.pointerId = null;
    const els = getImageViewerElements();
    if (els.backdrop) {
        els.backdrop.classList.remove('active');
        els.backdrop.setAttribute('aria-hidden', 'true');
    }
    if (els.viewport) els.viewport.classList.remove('dragging');
    if (els.image) {
        els.image.removeAttribute('src');
        els.image.removeAttribute('alt');
        els.image.style.transform = '';
    }
    imageViewerState.lastScaleLabel = '';
}


/**
 * 打开图片查看器。
 *
 * @param {string} url - 图片地址
 * @param {string} alt - 图片替代文本
 */
function openImageViewer(url, alt = 'image') {
    const safeUrl = String(url || '').trim();
    const els = getImageViewerElements();
    if (!safeUrl || !els.backdrop || !els.image) return;
    cancelImageViewerTransformFrame();
    resetImageViewerTransform({ immediate: true });
    els.image.decoding = 'async';
    if (els.image.getAttribute('src') !== safeUrl) {
        els.image.src = safeUrl;
    }
    els.image.alt = String(alt || 'image');
    imageViewerState.active = true;
    els.backdrop.classList.add('active');
    els.backdrop.setAttribute('aria-hidden', 'false');
}


/**
 * 按系数缩放图片。
 *
 * @param {number} factor - 缩放系数
 */
function zoomImageViewer(factor) {
    if (!imageViewerState.active) return;
    const next = clampImageViewerScale(imageViewerState.scale * Number(factor || 1));
    if (Math.abs(next - imageViewerState.scale) < 0.001) {
        return;
    }

    imageViewerState.scale = next;
    applyImageViewerTransform(true);
}


/**
 * 绑定图片查看器交互事件（幂等）。
 */
function bindImageViewerEvents() {
    const els = getImageViewerElements();
    if (!els.backdrop || els.backdrop.dataset.bindDone === '1') return;
    els.backdrop.dataset.bindDone = '1';

    if (els.close) {
        els.close.addEventListener('click', closeImageViewer);
    }
    if (els.reset) {
        els.reset.addEventListener('click', resetImageViewerTransform);
    }
    if (els.zoomIn) {
        els.zoomIn.addEventListener('click', () => zoomImageViewer(1.2));
    }
    if (els.zoomOut) {
        els.zoomOut.addEventListener('click', () => zoomImageViewer(1 / 1.2));
    }
    els.backdrop.addEventListener('click', (e) => {
        if (e.target === els.backdrop) closeImageViewer();
    });

    if (els.viewport) {
        els.viewport.addEventListener('wheel', (e) => {
            if (!imageViewerState.active) return;
            e.preventDefault();
            if (e.deltaY < 0) zoomImageViewer(1.08);
            else zoomImageViewer(1 / 1.08);
        }, { passive: false });

        els.viewport.addEventListener('pointerdown', (e) => {
            if (!imageViewerState.active) return;
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault();
            imageViewerState.dragging = true;
            imageViewerState.pointerId = e.pointerId;
            imageViewerState.dragStartX = e.clientX - imageViewerState.tx;
            imageViewerState.dragStartY = e.clientY - imageViewerState.ty;
            els.viewport.classList.add('dragging');
            try {
                els.viewport.setPointerCapture(e.pointerId);
            } catch (_) {}
        });

        els.viewport.addEventListener('pointermove', (e) => {
            if (!imageViewerState.active || !imageViewerState.dragging) return;
            if (imageViewerState.pointerId !== null && e.pointerId !== imageViewerState.pointerId) return;
            e.preventDefault();
            imageViewerState.tx = e.clientX - imageViewerState.dragStartX;
            imageViewerState.ty = e.clientY - imageViewerState.dragStartY;
            applyImageViewerTransform();
        });

        const finishImageViewerDrag = (e) => {
            if (!imageViewerState.dragging) return;
            if (imageViewerState.pointerId !== null && e.pointerId !== imageViewerState.pointerId) return;
            const pointerId = imageViewerState.pointerId;
            imageViewerState.dragging = false;
            imageViewerState.pointerId = null;
            if (getImageViewerElements().viewport) getImageViewerElements().viewport.classList.remove('dragging');
            releaseImageViewerPointerCapture(pointerId);
        };

        window.addEventListener('pointerup', finishImageViewerDrag);
        window.addEventListener('pointercancel', finishImageViewerDrag);
    }

    document.addEventListener('keydown', (e) => {
        if (!imageViewerState.active) return;
        if (e.key === 'Escape') closeImageViewer();
        else if (e.key === '+') zoomImageViewer(1.2);
        else if (e.key === '-') zoomImageViewer(1 / 1.2);
        else if (e.key === '0') resetImageViewerTransform();
    });
}

export {
    bindImageViewerEvents,
    closeImageViewer,
    openImageViewer,
    resetImageViewerTransform,
    zoomImageViewer,
};
