/**
 * chat_avatar.js — 头像裁切与用户资料
 *
 * 职责：头像裁切 canvas 操作（缩放/拖拽/圆形裁切/预览）；从 chat.js 批量迁移。
 * 共享可变状态收敛于模块内 avatarCropState 对象，通过 window 桥接对外暴露入口。
 *
 * 对外 window 桥接清单：
 *   - openAvatarCropModal / closeAvatarCropModal / applyAvatarCropAndPreview / resetAvatarCropPosition
 *
 * 依赖 store 子域：
 *   - 无（裁切为纯 DOM/canvas 操作）
 *
 * 设计形态：函数式（状态收敛于模块内 avatarCropState 对象）
 */
import {
    showToast,
} from './chat.js?v=20260819_toast_unify_01';

const avatarCropState = {
    img: null,
    canvas: null,
    ctx: null,
    isDragging: false,
    startX: 0,
    startY: 0,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    baseScale: 1,
    circleX: 0,
    circleY: 0,
    circleR: 0,
    drawWidth: 0,
    drawHeight: 0,
    drawX: 0,
    drawY: 0,
    rafPending: false
};

function openAvatarCropModal(file) {
    const modal = document.getElementById('avatarCropModal');
    const canvas = document.getElementById('avatarCropCanvas');
    const zoomInput = document.getElementById('avatarCropZoom');
    if (!modal || !canvas || !zoomInput) return;
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            avatarCropState.img = img;
            avatarCropState.canvas = canvas;
            avatarCropState.ctx = canvas.getContext('2d');
            avatarCropState.zoom = 1;
            avatarCropState.offsetX = 0;
            avatarCropState.offsetY = 0;
            zoomInput.value = '100';
            bindAvatarCropCanvasEvents();
            modal.classList.add('active');
            requestAnimationFrame(() => {
                initializeAvatarCropCanvasSize();
                drawAvatarCropCanvas();
            });
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

function closeAvatarCropModal() {
    const modal = document.getElementById('avatarCropModal');
    if (modal) modal.classList.remove('active');
    avatarCropState.isDragging = false;
}

function bindAvatarCropCanvasEvents() {
    const canvas = avatarCropState.canvas;
    const zoomInput = document.getElementById('avatarCropZoom');
    if (!canvas || canvas.dataset.avatarBound === '1') return;
    canvas.dataset.avatarBound = '1';
    canvas.style.touchAction = 'none';

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
        const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
        return { x, y };
    };

    const queueDraw = () => {
        if (avatarCropState.rafPending) return;
        avatarCropState.rafPending = true;
        requestAnimationFrame(() => {
            avatarCropState.rafPending = false;
            drawAvatarCropCanvas();
        });
    };

    canvas.addEventListener('pointerdown', (e) => {
        const p = getPos(e);
        avatarCropState.isDragging = true;
        avatarCropState.startX = p.x;
        avatarCropState.startY = p.y;
        if (canvas.setPointerCapture) {
            canvas.setPointerCapture(e.pointerId);
        }
        canvas.style.cursor = 'grabbing';
        queueDraw();
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!avatarCropState.isDragging) return;
        const p = getPos(e);
        const dx = p.x - avatarCropState.startX;
        const dy = p.y - avatarCropState.startY;
        avatarCropState.offsetX += dx;
        avatarCropState.offsetY += dy;
        avatarCropState.startX = p.x;
        avatarCropState.startY = p.y;
        queueDraw();
    });

    const stopDrag = (e) => {
        if (!avatarCropState.isDragging) return;
        avatarCropState.isDragging = false;
        canvas.style.cursor = 'grab';
        if (canvas.releasePointerCapture && e && typeof e.pointerId === 'number') {
            try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        }
    };
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
    canvas.addEventListener('dblclick', resetAvatarCropPosition);
    canvas.addEventListener('wheel', (e) => {
        if (!zoomInput) return;
        e.preventDefault();
        const current = Number(zoomInput.value || 100);
        const delta = e.deltaY < 0 ? 8 : -8;
        const next = Math.max(100, Math.min(250, current + delta));
        zoomInput.value = String(next);
        avatarCropState.zoom = next / 100;
        queueDraw();
    }, { passive: false });

    if (zoomInput) {
        zoomInput.addEventListener('input', (e) => {
            avatarCropState.zoom = Number(e.target.value || 100) / 100;
            queueDraw();
        });
    }
}

function initializeAvatarCropCanvasSize() {
    const { canvas, img } = avatarCropState;
    if (!canvas || !img) return;

    const wrap = canvas.parentElement;
    if (!wrap) {
        console.error('[AVATAR_CROP] canvas wrap not found');
        return;
    }

    const rect = wrap.getBoundingClientRect();
    const cssWidth = Math.round(rect.width);
    const cssHeight = Math.round(rect.height);

    if (cssWidth <= 0 || cssHeight <= 0) {
        console.error('[AVATAR_CROP] invalid canvas wrap size', { cssWidth, cssHeight });
        return;
    }

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.round(cssWidth * dpr);
    const height = Math.round(cssHeight * dpr);

    canvas.width = width;
    canvas.height = height;
    avatarCropState.circleX = Math.round(width / 2);
    avatarCropState.circleY = Math.round(height / 2);
    avatarCropState.circleR = Math.round(Math.min(width, height) * 0.34);
    avatarCropState.baseScale = Math.max(
        (avatarCropState.circleR * 2) / img.width,
        (avatarCropState.circleR * 2) / img.height
    );
    avatarCropState.offsetX = 0;
    avatarCropState.offsetY = 0;
}

function resetAvatarCropPosition() {
    const zoomInput = document.getElementById('avatarCropZoom');
    avatarCropState.zoom = 1;
    avatarCropState.offsetX = 0;
    avatarCropState.offsetY = 0;

    if (zoomInput) {
        zoomInput.value = '100';
    }

    drawAvatarCropCanvas();
}

function clampAvatarCropOffset() {
    const { canvas, img, zoom, baseScale, circleX, circleY, circleR } = avatarCropState;
    if (!canvas || !img) return;

    const scale = baseScale * zoom;
    const drawWidth = img.width * scale;
    const drawHeight = img.height * scale;
    const centeredX = (canvas.width - drawWidth) / 2;
    const centeredY = (canvas.height - drawHeight) / 2;
    const minDrawX = circleX + circleR - drawWidth;
    const maxDrawX = circleX - circleR;
    const minDrawY = circleY + circleR - drawHeight;
    const maxDrawY = circleY - circleR;

    avatarCropState.offsetX = Math.max(minDrawX - centeredX, Math.min(maxDrawX - centeredX, avatarCropState.offsetX));
    avatarCropState.offsetY = Math.max(minDrawY - centeredY, Math.min(maxDrawY - centeredY, avatarCropState.offsetY));
}
function drawAvatarCropCanvas() {
    const { canvas, ctx, img, zoom, baseScale, circleX, circleY, circleR } = avatarCropState;
    if (!canvas || !ctx || !img) return;
    clampAvatarCropOffset();
    const clampedOffsetX = avatarCropState.offsetX;
    const clampedOffsetY = avatarCropState.offsetY;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = baseScale * zoom;
    const drawWidth = img.width * scale;
    const drawHeight = img.height * scale;
    const drawX = (canvas.width - drawWidth) / 2 + clampedOffsetX;
    const drawY = (canvas.height - drawHeight) / 2 + clampedOffsetY;
    avatarCropState.drawWidth = drawWidth;
    avatarCropState.drawHeight = drawHeight;
    avatarCropState.drawX = drawX;
    avatarCropState.drawY = drawY;

    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.arc(circleX, circleY, circleR, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(circleX, circleY, circleR + 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(circleX, circleY, circleR, 0, Math.PI * 2);
    ctx.stroke();

    drawAvatarPreviewCanvas();
}

function getAvatarCircleSourceRect() {
    const { img, circleX, circleY, circleR, drawX, drawY, drawWidth, drawHeight } = avatarCropState;
    if (!img || !drawWidth || !drawHeight) return null;
    const x = circleX - circleR;
    const y = circleY - circleR;
    const w = circleR * 2;
    const h = circleR * 2;

    const sx = Math.max(0, ((x - drawX) / drawWidth) * img.width);
    const sy = Math.max(0, ((y - drawY) / drawHeight) * img.height);
    const sw = Math.min(img.width - sx, (w / drawWidth) * img.width);
    const sh = Math.min(img.height - sy, (h / drawHeight) * img.height);
    return { sx, sy, sw, sh };
}

function drawAvatarPreviewCanvas() {
    const preview = document.getElementById('avatarPreviewCanvas');
    if (!preview || !avatarCropState.img) return;
    const pctx = preview.getContext('2d');
    const src = getAvatarCircleSourceRect();
    if (!src) return;
    pctx.clearRect(0, 0, preview.width, preview.height);
    pctx.save();
    pctx.beginPath();
    pctx.arc(preview.width / 2, preview.height / 2, preview.width / 2 - 2, 0, Math.PI * 2);
    pctx.clip();
    pctx.drawImage(
        avatarCropState.img,
        src.sx,
        src.sy,
        src.sw,
        src.sh,
        0,
        0,
        preview.width,
        preview.height
    );
    pctx.restore();
}

function applyAvatarCropAndPreview() {
    const { img } = avatarCropState;
    if (!img) return;
    const src = getAvatarCircleSourceRect();
    if (!src) return;
    const size = 512;
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const octx = out.getContext('2d');
    octx.clearRect(0, 0, size, size);
    // UI uses circle for positioning preview, but uploaded avatar keeps normal square image.
    octx.drawImage(img, src.sx, src.sy, src.sw, src.sh, 0, 0, size, size);
    window.pendingAvatarDataUrl = out.toDataURL('image/png');
    const avatarImg = document.getElementById('settingsAvatarImg');
    if (avatarImg) avatarImg.src = window.pendingAvatarDataUrl;
    closeAvatarCropModal();
    showToast('头像已裁切，点击“保存资料”后生效');
}
// ─── window 桥接 ───
window.openAvatarCropModal = openAvatarCropModal;
window.closeAvatarCropModal = closeAvatarCropModal;
window.applyAvatarCropAndPreview = applyAvatarCropAndPreview;
window.resetAvatarCropPosition = resetAvatarCropPosition;


// ─── 命名导出（供 chat.js import） ───
export {
    applyAvatarCropAndPreview,
    avatarCropState,
    bindAvatarCropCanvasEvents,
    clampAvatarCropOffset,
    closeAvatarCropModal,
    drawAvatarCropCanvas,
    drawAvatarPreviewCanvas,
    getAvatarCircleSourceRect,
    initializeAvatarCropCanvasSize,
    openAvatarCropModal,
    resetAvatarCropPosition,
};
