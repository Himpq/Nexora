(function () {
    'use strict';

    const MODULE_NAME = 'toolCanvas';

    const CLIENT_JS_THREE_CDN_URLS = [
        'https://cdnjs.cloudflare.com/ajax/libs/three.js/r152/three.min.js',
        'https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.min.js',
        'https://unpkg.com/three@0.152.2/build/three.min.js'
    ];
    const clientJsCanvasRequestMap = new Map();
    let clientJsThreeLoadPromise = null;
    const CLIENT_TOOL_POLL_MIN_MS = 700;
    const CLIENT_TOOL_POLL_MAX_MS = 6000;
    const CLIENT_TOOL_POLL_NO_CONV_MS = 5000;
    const CLIENT_TOOL_POLL_ERROR_MS = 3500;
    const CLIENT_TOOL_POLL_HIT_MS = 220;
    const CLIENT_TOOL_PULL_WAIT_MS = 12000;
    const UTF8_BOM_CHAR = String.fromCharCode(0xFEFF);
    const JS_LINE_SEPARATOR_PATTERN = new RegExp(
        `[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`,
        'g'
    );
    const FULLWIDTH_SPACE_CHAR = String.fromCharCode(0x3000);
    const FULLWIDTH_ASCII_PATTERN = new RegExp(
        `[${String.fromCharCode(0xFF01)}-${String.fromCharCode(0xFF5E)}]`,
        'g'
    );

    function getShared() {
        const shared = window.NexoraChatShared;

        if (!shared || typeof shared.registerModule !== 'function') {
            throw new Error('NexoraChatShared 未初始化，无法注册 Chat Tool Canvas 模块');
        }

        return shared;
    }

    function requireToolCanvasDependency(deps, name) {
        const source = deps && typeof deps === 'object' ? deps : null;
        const value = source ? source[name] : null;

        if (typeof value !== 'function') {
            throw new Error(`chat_tool_canvas 缺少依赖: ${name}`);
        }

        return value;
    }

    function normalizeClientJsTimeoutMs(v, fallback = 8000) {
    
        const raw = Number(v);
    
        const n = Number.isFinite(raw) ? Math.floor(raw) : Math.floor(fallback);
    
        return Math.max(500, Math.min(30000, n));
    
    }
    
    function normalizeClientJsCode(rawCode) {
    
        let code = String(rawCode || '');
    
        if (!code) return '';
    
        code = code.replace(UTF8_BOM_CHAR, '').replace(JS_LINE_SEPARATOR_PATTERN, '\n');
        const trimmed = code.trim();
    
    
    
        try {
    
            const parsed = JSON.parse(trimmed);
    
            if (typeof parsed === 'string') {
    
                code = parsed;
    
            } else if (parsed && typeof parsed === 'object' && typeof parsed.code === 'string') {
    
                code = parsed.code;
    
            }
    
        } catch (_) {
    
            // keep raw string as-is
    
        }
    
    
    
        code = String(code || '').replace(UTF8_BOM_CHAR, '').replace(JS_LINE_SEPARATOR_PATTERN, '\n');
        const fenced = code.trim().match(/^```(?:javascript|js|jsx|typescript|ts)?\s*([\s\S]*?)\s*```$/i);
    
        if (fenced) {
    
            code = fenced[1];
    
        }
    
    
    
        // normalize common LLM typography that breaks JS parser
    
        code = code
    
            .replace(/[“”]/g, '"')
    
            .replace(/[‘’]/g, "'")
    
            .replaceAll(FULLWIDTH_SPACE_CHAR, ' ')
            .replace(FULLWIDTH_ASCII_PATTERN, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    
    
        return code.trim();
    
    }
    
    function parseJsonObjectMaybe(raw) {
    
        if (raw && typeof raw === 'object') return raw;
    
        const text = String(raw || '').trim();
    
        if (!text) return null;
    
        try {
    
            const parsed = JSON.parse(text);
    
            return (parsed && typeof parsed === 'object') ? parsed : null;
    
        } catch (_) {
    
            return null;
    
        }
    
    }
    
    function detectThreeUsageInJsCode(code) {
    
        const src = String(code || '');
    
        if (!src.trim()) return false;
    
        if (/\bTHREE\b/.test(src)) return true;
    
        if (/\benableThreeOrbit\b|\battachOrbitControl\b/.test(src)) return true;
    
        if (/\bWebGLRenderer\b/.test(src)) return true;
    
        if (/\bPerspectiveCamera\b|\bOrthographicCamera\b/.test(src)) return true;
    
        if (/\bScene\b|\bBufferGeometry\b|\bMesh\b/.test(src)) return true;
    
        return false;
    
    }
    
    function detectPlot3DUsageInJsCode(code) {
    
        const src = String(code || '');
    
        if (!src.trim()) return false;
    
        if (/\bPlot3D\b/.test(src)) return true;
    
        if (/\bsurface3d\b/i.test(src)) return true;
    
        if (/\bline3d\b/i.test(src)) return true;
    
        return false;
    
    }
    
    function extractRequestedJsLibs(context) {
    
        const ctx = (context && typeof context === 'object') ? context : {};
    
        const raw = (ctx.libs != null) ? ctx.libs : (ctx.libraries != null ? ctx.libraries : ctx.lib);
    
        const out = new Set();
    
        if (Array.isArray(raw)) {
    
            raw.forEach((item) => {
    
                const v = String(item || '').trim().toLowerCase();
    
                if (v) out.add(v);
    
            });
    
            return out;
    
        }
    
        if (typeof raw === 'string') {
    
            raw.split(/[,\s|]+/g).forEach((item) => {
    
                const v = String(item || '').trim().toLowerCase();
    
                if (v) out.add(v);
    
            });
    
            return out;
    
        }
    
        if (raw && typeof raw === 'object') {
    
            Object.keys(raw).forEach((k) => {
    
                if (!raw[k]) return;
    
                const v = String(k || '').trim().toLowerCase();
    
                if (v) out.add(v);
    
            });
    
        }
    
        return out;
    
    }
    
    function needsThreeJsForCanvas(code, context = {}) {
    
        const libs = extractRequestedJsLibs(context);
    
        if (libs.has('three') || libs.has('threejs') || libs.has('three.js')) return true;
    
        return detectThreeUsageInJsCode(code);
    
    }
    
    function needsPlot3DHelper(code, context = {}) {
    
        const libs = extractRequestedJsLibs(context);
    
        if (libs.has('plot3d') || libs.has('matplot3d') || libs.has('matplotlib3d') || libs.has('mini3d')) return true;
    
        return detectPlot3DUsageInJsCode(code);
    
    }
    
    function loadScriptByUrl(url) {
    
        return new Promise((resolve, reject) => {
    
            const u = String(url || '').trim();
    
            if (!u) {
    
                reject(new Error('empty script url'));
    
                return;
    
            }
    
            const existing = Array.from(document.querySelectorAll('script[src]'))
    
                .find((node) => String(node.getAttribute('src') || '').includes(u));
    
            if (existing) {
    
                if (window.THREE) {
    
                    resolve(window.THREE);
    
                    return;
    
                }
    
                existing.addEventListener('load', () => resolve(window.THREE), { once: true });
    
                existing.addEventListener('error', () => reject(new Error(`script load failed: ${u}`)), { once: true });
    
                return;
    
            }
    
    
    
            const script = document.createElement('script');
    
            script.src = u;
    
            script.async = true;
    
            script.onload = () => resolve(window.THREE);
    
            script.onerror = () => reject(new Error(`script load failed: ${u}`));
    
            document.head.appendChild(script);
    
        });
    
    }
    
    async function ensureClientJsThreeLoaded() {
    
        if (window.THREE) return window.THREE;
    
        if (clientJsThreeLoadPromise) return clientJsThreeLoadPromise;
    
        clientJsThreeLoadPromise = (async () => {
    
            let lastErr = null;
    
            for (const url of CLIENT_JS_THREE_CDN_URLS) {
    
                try {
    
                    await loadScriptByUrl(url);
    
                    if (window.THREE) return window.THREE;
    
                } catch (e) {
    
                    lastErr = e;
    
                }
    
            }
    
            throw (lastErr || new Error('Three.js load failed'));
    
        })();
    
        try {
    
            return await clientJsThreeLoadPromise;
    
        } finally {
    
            if (!window.THREE) clientJsThreeLoadPromise = null;
    
        }
    
    }
    
    function createPlot3DHelper(canvas, ctx) {
    
        const width = Number((canvas && canvas.width) || 640);
    
        const height = Number((canvas && canvas.height) || 360);
    
        const project = (x, y, z, opts = {}) => {
    
            const yaw = Number(opts.yaw != null ? opts.yaw : -0.78);
    
            const pitch = Number(opts.pitch != null ? opts.pitch : 0.62);
    
            const scale = Number(opts.scale != null ? opts.scale : Math.min(width, height) * 0.22);
    
            const ox = Number(opts.ox != null ? opts.ox : width * 0.5);
    
            const oy = Number(opts.oy != null ? opts.oy : height * 0.56);
    
            const cy = Math.cos(yaw);
    
            const sy = Math.sin(yaw);
    
            const cp = Math.cos(pitch);
    
            const sp = Math.sin(pitch);
    
            const xr = x * cy - z * sy;
    
            const zr = x * sy + z * cy;
    
            const yr = y * cp - zr * sp;
    
            return {
    
                x: ox + xr * scale,
    
                y: oy - yr * scale
    
            };
    
        };
    
        const clear = (bg = '#ffffff') => {
    
            ctx.save();
    
            ctx.fillStyle = String(bg || '#ffffff');
    
            ctx.fillRect(0, 0, width, height);
    
            ctx.restore();
    
        };
    
        const line3d = (points = [], opts = {}) => {
    
            const arr = Array.isArray(points) ? points : [];
    
            if (arr.length < 2) return;
    
            ctx.save();
    
            ctx.strokeStyle = String(opts.color || '#0f172a');
    
            ctx.lineWidth = Number(opts.width || 1.15);
    
            ctx.beginPath();
    
            arr.forEach((p, i) => {
    
                const item = Array.isArray(p) ? p : [0, 0, 0];
    
                const pt = project(Number(item[0] || 0), Number(item[1] || 0), Number(item[2] || 0), opts);
    
                if (i === 0) ctx.moveTo(pt.x, pt.y);
    
                else ctx.lineTo(pt.x, pt.y);
    
            });
    
            ctx.stroke();
    
            ctx.restore();
    
        };
    
        const axes = (opts = {}) => {
    
            const size = Number(opts.size || 1.6);
    
            line3d([[-size, 0, 0], [size, 0, 0]], { ...opts, color: opts.xColor || '#e11d48' });
    
            line3d([[0, -size, 0], [0, size, 0]], { ...opts, color: opts.yColor || '#2563eb' });
    
            line3d([[0, 0, -size], [0, 0, size]], { ...opts, color: opts.zColor || '#16a34a' });
    
        };
    
        const surface = (fn, opts = {}) => {
    
            if (typeof fn !== 'function') return;
    
            const xMin = Number(opts.xMin != null ? opts.xMin : -2);
    
            const xMax = Number(opts.xMax != null ? opts.xMax : 2);
    
            const zMin = Number(opts.zMin != null ? opts.zMin : -2);
    
            const zMax = Number(opts.zMax != null ? opts.zMax : 2);
    
            const xSteps = Math.max(2, Math.min(120, Math.floor(Number(opts.xSteps != null ? opts.xSteps : 30))));
    
            const zSteps = Math.max(2, Math.min(120, Math.floor(Number(opts.zSteps != null ? opts.zSteps : 30))));
    
            const color = String(opts.color || '#334155');
    
            const widthPx = Number(opts.width || 0.9);
    
    
    
            const grid = [];
    
            for (let i = 0; i <= xSteps; i += 1) {
    
                const x = xMin + ((xMax - xMin) * (i / xSteps));
    
                const row = [];
    
                for (let j = 0; j <= zSteps; j += 1) {
    
                    const z = zMin + ((zMax - zMin) * (j / zSteps));
    
                    let y = 0;
    
                    try { y = Number(fn(x, z)); } catch (_) { y = 0; }
    
                    if (!Number.isFinite(y)) y = 0;
    
                    row.push([x, y, z]);
    
                }
    
                grid.push(row);
    
            }
    
    
    
            for (let i = 0; i <= xSteps; i += 1) {
    
                line3d(grid[i], { ...opts, color, width: widthPx });
    
            }
    
            for (let j = 0; j <= zSteps; j += 1) {
    
                const col = [];
    
                for (let i = 0; i <= xSteps; i += 1) col.push(grid[i][j]);
    
                line3d(col, { ...opts, color, width: widthPx });
    
            }
    
        };
    
        return {
    
            clear,
    
            project,
    
            line3d,
    
            axes,
    
            surface
    
        };
    
    }
    
    function enforceCanvasDisplayAspect(canvas) {
    
        if (!canvas) return;
    
        const w = Math.max(1, Number(canvas.width || 0) || 1);
    
        const h = Math.max(1, Number(canvas.height || 0) || 1);
    
        canvas.style.width = '100%';
    
        canvas.style.maxWidth = '100%';
    
        canvas.style.height = 'auto';
    
        canvas.style.aspectRatio = `${w} / ${h}`;
    
    }
    
    function clampNumber(v, min, max) {
    
        const n = Number(v);
    
        if (!Number.isFinite(n)) return min;
    
        return Math.max(Number(min), Math.min(Number(max), n));
    
    }
    
    function normalizeThreeTargetVector(threeRef, rawTarget) {
    
        const fallback = new threeRef.Vector3(0, 0, 0);
    
        if (!rawTarget) return fallback;
    
        if (rawTarget instanceof threeRef.Vector3) return rawTarget.clone();
    
        if (Array.isArray(rawTarget) && rawTarget.length >= 3) {
    
            const x = Number(rawTarget[0] || 0);
    
            const y = Number(rawTarget[1] || 0);
    
            const z = Number(rawTarget[2] || 0);
    
            return new threeRef.Vector3(x, y, z);
    
        }
    
        if (typeof rawTarget === 'object') {
    
            const x = Number(rawTarget.x || 0);
    
            const y = Number(rawTarget.y || 0);
    
            const z = Number(rawTarget.z || 0);
    
            return new threeRef.Vector3(x, y, z);
    
        }
    
        return fallback;
    
    }
    
    function createThreeOrbitController(canvas, threeRef, options = {}) {
    
        if (!canvas || !threeRef) {
    
            throw new Error('enableThreeOrbit requires canvas and THREE');
    
        }
    
        const opts = (options && typeof options === 'object') ? options : {};
    
        const camera = opts.camera;
    
        if (!camera || !camera.position || typeof camera.lookAt !== 'function') {
    
            throw new Error('enableThreeOrbit requires a valid THREE camera');
    
        }
    
        const scene = opts.scene || null;
    
        const renderer = opts.renderer || null;
    
        const target = normalizeThreeTargetVector(threeRef, opts.target);
    
        const rotateSpeed = clampNumber(opts.rotateSpeed != null ? opts.rotateSpeed : 1.25, 0.2, 6);
    
        const minPhi = clampNumber(opts.minPhi != null ? opts.minPhi : 0.08, 0.02, Math.PI * 0.48);
    
        const maxPhi = clampNumber(opts.maxPhi != null ? opts.maxPhi : (Math.PI - 0.08), Math.PI * 0.52, Math.PI - 0.02);
    
        const minRadius = clampNumber(opts.minRadius != null ? opts.minRadius : 0.2, 0.001, 1e7);
    
        const maxRadius = clampNumber(opts.maxRadius != null ? opts.maxRadius : 5000, minRadius, 1e9);
    
    
    
        const toSphericalFromCamera = () => {
    
            const offset = new threeRef.Vector3().copy(camera.position).sub(target);
    
            const radiusRaw = Number(offset.length());
    
            const radius = clampNumber(Number.isFinite(radiusRaw) && radiusRaw > 0 ? radiusRaw : 3, minRadius, maxRadius);
    
            const theta = Math.atan2(offset.x, offset.z);
    
            const phiRaw = Math.acos(clampNumber(offset.y / radius, -1, 1));
    
            const phi = clampNumber(phiRaw, minPhi, maxPhi);
    
            return { radius, theta, phi };
    
        };
    
    
    
        let spherical = toSphericalFromCamera();
    
        if (Number.isFinite(Number(opts.radius))) {
    
            spherical.radius = clampNumber(Number(opts.radius), minRadius, maxRadius);
    
        }
    
        if (Number.isFinite(Number(opts.theta))) {
    
            spherical.theta = Number(opts.theta);
    
        }
    
        if (Number.isFinite(Number(opts.phi))) {
    
            spherical.phi = clampNumber(Number(opts.phi), minPhi, maxPhi);
    
        }
    
    
    
        const renderFn = (typeof opts.render === 'function')
    
            ? opts.render
    
            : (() => {
    
                if (renderer && scene && typeof renderer.render === 'function') {
    
                    renderer.render(scene, camera);
    
                }
    
            });
    
    
    
        const applyPose = () => {
    
            const sinPhi = Math.sin(spherical.phi);
    
            const x = target.x + spherical.radius * sinPhi * Math.sin(spherical.theta);
    
            const y = target.y + spherical.radius * Math.cos(spherical.phi);
    
            const z = target.z + spherical.radius * sinPhi * Math.cos(spherical.theta);
    
            camera.position.set(x, y, z);
    
            camera.lookAt(target);
    
            try {
    
                renderFn();
    
            } catch (_) {
    
                // ignore render callback errors
    
            }
    
        };
    
    
    
        const state = {
    
            pointerId: null,
    
            dragging: false,
    
            startX: 0,
    
            startY: 0,
    
            startTheta: spherical.theta,
    
            startPhi: spherical.phi
    
        };
    
        const prevTouchAction = String(canvas.style.touchAction || '');
    
        canvas.style.touchAction = 'none';
    
    
    
        const onPointerDown = (ev) => {
    
            if (!ev) return;
    
            if (ev.pointerType === 'mouse' && Number(ev.button) !== 0) return;
    
            state.dragging = true;
    
            state.pointerId = ev.pointerId;
    
            state.startX = Number(ev.clientX || 0);
    
            state.startY = Number(ev.clientY || 0);
    
            state.startTheta = spherical.theta;
    
            state.startPhi = spherical.phi;
    
            try { canvas.setPointerCapture(ev.pointerId); } catch (_) {}
    
            ev.preventDefault();
    
        };
    
    
    
        const onPointerMove = (ev) => {
    
            if (!state.dragging || !ev) return;
    
            if (state.pointerId != null && ev.pointerId !== state.pointerId) return;
    
            const dx = Number(ev.clientX || 0) - state.startX;
    
            const dy = Number(ev.clientY || 0) - state.startY;
    
            const refWidth = Math.max(180, Number(canvas.clientWidth || canvas.width || 360));
    
            const refHeight = Math.max(180, Number(canvas.clientHeight || canvas.height || 220));
    
            const thetaDelta = (dx / refWidth) * Math.PI * rotateSpeed;
    
            const phiDelta = (dy / refHeight) * Math.PI * rotateSpeed;
    
            spherical.theta = state.startTheta + thetaDelta;
    
            spherical.phi = clampNumber(state.startPhi + phiDelta, minPhi, maxPhi);
    
            applyPose();
    
            ev.preventDefault();
    
        };
    
    
    
        const stopPointer = (ev) => {
    
            if (!state.dragging) return;
    
            if (ev && state.pointerId != null && ev.pointerId !== state.pointerId) return;
    
            state.dragging = false;
    
            if (ev && state.pointerId != null) {
    
                try { canvas.releasePointerCapture(state.pointerId); } catch (_) {}
    
            }
    
            state.pointerId = null;
    
        };
    
    
    
        canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    
        window.addEventListener('pointermove', onPointerMove, { passive: false });
    
        window.addEventListener('pointerup', stopPointer, { passive: true });
    
        window.addEventListener('pointercancel', stopPointer, { passive: true });
    
    
    
        applyPose();
    
    
    
        return {
    
            dispose() {
    
                canvas.removeEventListener('pointerdown', onPointerDown);
    
                window.removeEventListener('pointermove', onPointerMove);
    
                window.removeEventListener('pointerup', stopPointer);
    
                window.removeEventListener('pointercancel', stopPointer);
    
                canvas.style.touchAction = prevTouchAction;
    
            },
    
            render: applyPose,
    
            setRadius(nextRadius) {
    
                spherical.radius = clampNumber(nextRadius, minRadius, maxRadius);
    
                applyPose();
    
            },
    
            setTarget(nextTarget) {
    
                const v = normalizeThreeTargetVector(threeRef, nextTarget);
    
                target.set(v.x, v.y, v.z);
    
                applyPose();
    
            }
    
        };
    
    }
    
    function detectCanvasUsageInJsCode(code) {
    
        const src = String(code || '');
    
        if (!src.trim()) return false;
    
        if (detectThreeUsageInJsCode(src)) return true;
    
        if (detectPlot3DUsageInJsCode(src)) return true;
    
        if (/getContext\s*\(\s*['"`]2d['"`]\s*\)/i.test(src)) return true;
    
        if (/createElement\s*\(\s*['"`]canvas['"`]\s*\)/i.test(src)) return true;
    
        if (/querySelector\s*\(\s*['"`][^'"`]*canvas/i.test(src)) return true;
    
        if (/getElementById\s*\(\s*['"`][^'"`]*canvas/i.test(src)) return true;
    
        if (/\bcanvas\s*\./i.test(src)) return true;
    
        if (/\bctx\s*\./i.test(src)) return true;
    
        return false;
    
    }
    
    function detect2DContextUsageInJsCode(code) {
    
        const src = String(code || '');
    
        if (!src.trim()) return false;
    
        if (detectPlot3DUsageInJsCode(src)) return true;
    
        if (/getContext\s*\(\s*['"`]2d['"`]\s*\)/i.test(src)) return true;
    
        if (/\bcontext\.ctx\b/.test(src)) return true;
    
        if (/\bctx\.(?:fillRect|strokeRect|clearRect|beginPath|moveTo|lineTo|arc|fillText|strokeText|drawImage|save|restore|translate|rotate|scale|setTransform)\b/.test(src)) return true;
    
        return false;
    
    }
    
    function normalizeCanvasDimension(value, fallback, min = 120, max = 2400) {
    
        const raw = Number(value);
    
        const n = Number.isFinite(raw) ? Math.floor(raw) : Math.floor(fallback);
    
        return Math.max(min, Math.min(max, n));
    
    }
    
    function extractCanvasMetaFromJsPayload(payload) {
    
        const p = (payload && typeof payload === 'object') ? payload : {};
    
        const rawCode = String(p.code || '');
    
        const code = normalizeClientJsCode(rawCode);
    
        const context = (p.context && typeof p.context === 'object') ? p.context : {};
    
        const timeoutMs = normalizeClientJsTimeoutMs(p.timeout_ms, 8000);
    
        const width = normalizeCanvasDimension(
    
            context.canvas_width != null ? context.canvas_width : context.width,
    
            640
    
        );
    
        const height = normalizeCanvasDimension(
    
            context.canvas_height != null ? context.canvas_height : context.height,
    
            360
    
        );
    
        return {
    
            usedCanvas: detectCanvasUsageInJsCode(code),
    
            code,
    
            rawCode,
    
            codeNormalized: code !== rawCode,
    
            context,
    
            timeoutMs,
    
            width,
    
            height
    
        };
    
    }
    
    function rememberClientJsCanvasMeta(requestId, meta) {
    
        const rid = String(requestId || '').trim();
    
        if (!rid || !meta || typeof meta !== 'object') return;
    
        clientJsCanvasRequestMap.set(rid, { ...meta, ts: Date.now() });
    
        if (clientJsCanvasRequestMap.size <= 400) return;
    
        const keys = Array.from(clientJsCanvasRequestMap.keys());
    
        for (let i = 0; i < 120; i += 1) {
    
            const k = keys[i];
    
            if (!k) break;
    
            clientJsCanvasRequestMap.delete(k);
    
        }
    
    }
    
    function findClientJsCanvasMetaFromResultPayload(resultPayload) {
    
        const payload = (resultPayload && typeof resultPayload === 'object') ? resultPayload : null;
    
        if (!payload) return null;
    
        const rid = String(payload.request_id || '').trim();
    
        if (!rid) return null;
    
        return clientJsCanvasRequestMap.get(rid) || null;
    
    }
    
    function parseJsExecuteArgumentsMeta(argumentsText) {
    
        const parsed = parseJsonObjectMaybe(argumentsText);
    
        if (!parsed) return null;
    
        const rawCode = String(parsed.code || '');
    
        const code = normalizeClientJsCode(rawCode);
    
        if (!code) return null;
    
        const context = (parsed.context && typeof parsed.context === 'object') ? parsed.context : {};
    
        const timeoutMs = normalizeClientJsTimeoutMs(parsed.timeout_ms, 8000);
    
        return {
    
            code,
    
            rawCode,
    
            codeNormalized: code !== rawCode,
    
            usedCanvas: detectCanvasUsageInJsCode(code),
    
            context,
    
            timeoutMs,
    
            width: normalizeCanvasDimension(context.canvas_width != null ? context.canvas_width : context.width, 640),
    
            height: normalizeCanvasDimension(context.canvas_height != null ? context.canvas_height : context.height, 360)
    
        };
    
    }
    
    function ensureMessageCanvasState(messageDiv) {
    
        if (!messageDiv) return null;
    
        if (!messageDiv.__canvasRenderState || typeof messageDiv.__canvasRenderState !== 'object') {
    
            messageDiv.__canvasRenderState = {
    
                callInfoByKey: {},
    
                renderedByKey: {},
    
                nextSeq: 1
    
            };
    
        }
    
        return messageDiv.__canvasRenderState;
    
    }
    
    function placeCanvasCardsBelowToolChain(messageDiv) {
    
        const parent = (messageDiv && (messageDiv.querySelector('.message-content') || messageDiv)) || null;
    
        if (!parent) return;
    
        const cards = Array.from(parent.querySelectorAll('.tool-canvas-card'));
    
        if (!cards.length) return;
    
    
    
        let lastToolNode = null;
    
        Array.from(parent.children || []).forEach((node) => {
    
            if (!node || !node.classList) return;
    
            if (node.classList.contains('tool-usage') || node.classList.contains('add-basis-view')) {
    
                lastToolNode = node;
    
            }
    
        });
    
    
    
        cards.forEach((card) => {
    
            if (card && card.parentNode === parent) {
    
                card.remove();
    
            }
    
        });
    
    
    
        if (lastToolNode && lastToolNode.parentNode === parent) {
    
            const ref = lastToolNode.nextSibling;
    
            cards.forEach((card) => {
    
                if (ref) parent.insertBefore(card, ref);
    
                else parent.appendChild(card);
    
            });
    
            return;
    
        }
    
    
    
        cards.forEach((card) => parent.appendChild(card));
    
    }
    
    function buildCanvasLookupKeys(callId, toolIndex) {
    
        const keys = [];
    
        const cid = String(callId || '').trim();
    
        if (cid) keys.push(`call:${cid}`);
    
        if (toolIndex !== undefined && toolIndex !== null && Number.isFinite(Number(toolIndex))) {
    
            keys.push(`idx:${Math.floor(Number(toolIndex))}`);
    
        }
    
        return keys;
    
    }
    
    function isClientJsExecToolName(toolName) {
    
        const name = String(toolName || '').trim();
    
        return name === 'js_execute' || name === 'client_js_exec';
    
    }
    
    function rememberJsExecuteCanvasCall(messageDiv, toolName, callId, toolIndex, argumentsText) {
    
        if (!messageDiv) return;
    
        if (!isClientJsExecToolName(toolName)) return;
    
        const meta = parseJsExecuteArgumentsMeta(argumentsText);
    
        if (!meta || !meta.usedCanvas) return;
    
        const state = ensureMessageCanvasState(messageDiv);
    
        if (!state) return;
    
        const keys = buildCanvasLookupKeys(callId, toolIndex);
    
        if (!keys.length) {
    
            keys.push(`anon:${state.nextSeq++}`);
    
        }
    
        keys.forEach((k) => {
    
            state.callInfoByKey[k] = meta;
    
        });
    
    }
    
    function createToolCanvasCard(messageDiv, renderKey, width, height) {
    
        const parent = (messageDiv && (messageDiv.querySelector('.message-content') || messageDiv)) || null;
    
        if (!parent) return null;
    
        let card = null;
    
        const key = String(renderKey || '');
    
        parent.querySelectorAll('.tool-canvas-card').forEach((node) => {
    
            if (card) return;
    
            if (String(node.dataset.canvasKey || '') === key) {
    
                card = node;
    
            }
    
        });
    
        if (card) return card;
    
    
    
        card = document.createElement('div');
    
        card.className = 'tool-canvas-card';
    
        card.dataset.canvasKey = key;
    
        card.innerHTML = `
    
            <div class="tool-canvas-head">Canvas 绘图</div>
    
            <div class="tool-canvas-wrap">
    
                <canvas class="tool-canvas"></canvas>
    
            </div>
    
            <div class="tool-canvas-status">准备绘制...</div>
    
        `;
    
    
    
        parent.appendChild(card);
    
    
    
        const canvas = card.querySelector('.tool-canvas');
    
        if (canvas) {
    
            canvas.width = normalizeCanvasDimension(width, 640);
    
            canvas.height = normalizeCanvasDimension(height, 360);
    
        }
    
        placeCanvasCardsBelowToolChain(messageDiv);
    
        return card;
    
    }
    
    async function runCanvasCodeInCard(card, code, context = {}, timeoutMs = 5000) {
    
        if (!card) return;
    
        const canvas = card.querySelector('.tool-canvas');
    
        const statusEl = card.querySelector('.tool-canvas-status');
    
        if (!canvas || typeof canvas.getContext !== 'function') {
    
            if (statusEl) statusEl.textContent = 'Canvas 不可用';
    
            card.classList.add('error');
    
            return;
    
        }
    
        enforceCanvasDisplayAspect(canvas);
    
        const runtimeCode = normalizeClientJsCode(code);
    
        if (!runtimeCode) {
    
            if (statusEl) statusEl.textContent = '空绘图代码';
    
            card.classList.add('error');
    
            return;
    
        }
    
        const ctxObj = (context && typeof context === 'object') ? context : {};
    
        const useThree = needsThreeJsForCanvas(runtimeCode, ctxObj);
    
        const usePlot3D = needsPlot3DHelper(runtimeCode, ctxObj);
    
        const need2dContext = !useThree && (usePlot3D || detect2DContextUsageInJsCode(runtimeCode));
    
        let ctx = null;
    
        if (need2dContext) {
    
            ctx = canvas.getContext('2d');
    
            if (!ctx) {
    
                if (statusEl) statusEl.textContent = '无法获取 2D 上下文';
    
                card.classList.add('error');
    
                return;
    
            }
    
        }
    
        let threeRef = null;
    
        let threeLoadErr = '';
    
        if (useThree) {
    
            try {
    
                if (statusEl) statusEl.textContent = '加载 Three.js...';
    
                threeRef = await ensureClientJsThreeLoaded();
    
            } catch (e) {
    
                threeLoadErr = `Three.js 加载失败: ${String((e && e.message) || e || '')}`;
    
            }
    
        }
    
    
    
        const logs = [];
    
        const pushLog = (level, args) => {
    
            const line = `[${level}] ${Array.from(args || []).map((x) => String(x)).join(' ')}`.slice(0, 420);
    
            logs.push(line);
    
            if (logs.length > 80) logs.splice(0, logs.length - 80);
    
        };
    
        const consoleProxy = {
    
            log: (...args) => pushLog('log', args),
    
            info: (...args) => pushLog('info', args),
    
            warn: (...args) => pushLog('warn', args),
    
            error: (...args) => pushLog('error', args)
    
        };
    
    
    
        const localContext = (ctxObj && typeof ctxObj === 'object') ? { ...ctxObj } : {};
    
        localContext.canvas = canvas;
    
        localContext.ctx = ctx;
    
        localContext.width = canvas.width;
    
        localContext.height = canvas.height;
    
        const ensure2DContext = () => {
    
            if (ctx) return ctx;
    
            try {
    
                const next = canvas.getContext('2d');
    
                if (next) {
    
                    ctx = next;
    
                    localContext.ctx = next;
    
                }
    
                return next || null;
    
            } catch (_) {
    
                return null;
    
            }
    
        };
    
        localContext.ensure2DContext = ensure2DContext;
    
        localContext.getContext = (kind = '2d', opts = undefined) => {
    
            const type = String(kind || '2d').toLowerCase();
    
            if (type === '2d') {
    
                return ensure2DContext();
    
            }
    
            try {
    
                return canvas.getContext(type, opts);
    
            } catch (_) {
    
                return null;
    
            }
    
        };
    
        const plot3d = (!useThree && usePlot3D && ctx) ? createPlot3DHelper(canvas, ctx) : null;
    
        const importScriptsProxy = (...urls) => {
    
            const list = Array.isArray(urls) ? urls : [];
    
            if (!list.length) return true;
    
            let handled = 0;
    
            for (const rawUrl of list) {
    
                const u = String(rawUrl || '').trim().toLowerCase();
    
                if (!u) continue;
    
                if (u.includes('three') && threeRef) {
    
                    handled += 1;
    
                    continue;
    
                }
    
                throw new Error('importScripts 在当前运行环境不可用；请直接使用 THREE / Plot3D');
    
            }
    
            return handled === list.length;
    
        };
    
        if (threeRef) localContext.THREE = threeRef;
    
        if (plot3d) localContext.Plot3D = plot3d;
    
        if (threeRef) {
    
            localContext.enableThreeOrbit = (opts = {}) => createThreeOrbitController(canvas, threeRef, opts);
    
        }
    
        localContext.importScripts = importScriptsProxy;
    
    
    
        const safeDocument = {
    
            getElementById: () => canvas,
    
            querySelector: () => canvas,
    
            querySelectorAll: () => [canvas],
    
            createElement: (tag) => {
    
                if (String(tag || '').toLowerCase() === 'canvas') return document.createElement('canvas');
    
                return document.createElement(String(tag || 'div'));
    
            }
    
        };
    
        const safeWindow = {
    
            devicePixelRatio: Number(window.devicePixelRatio || 1) || 1,
    
            innerWidth: canvas.width,
    
            innerHeight: canvas.height
    
        };
    
        if (threeRef) safeWindow.THREE = threeRef;
    
        if (plot3d) safeWindow.Plot3D = plot3d;
    
        if (threeRef) safeWindow.enableThreeOrbit = (opts = {}) => createThreeOrbitController(canvas, threeRef, opts);
    
        safeWindow.importScripts = importScriptsProxy;
    
        safeWindow.getContext = localContext.getContext;
    
        safeWindow.ensure2DContext = ensure2DContext;
    
        const raf = (fn) => setTimeout(() => fn(Date.now()), 16);
    
        const caf = (id) => clearTimeout(id);
    
        localContext.document = safeDocument;
    
        localContext.window = safeWindow;
    
        localContext.requestAnimationFrame = raf;
    
        localContext.cancelAnimationFrame = caf;
    
    
    
        card.classList.remove('error');
    
        if (statusEl) {
    
            statusEl.textContent = threeLoadErr ? 'Three.js加载失败，尝试继续绘制...' : '绘制中...';
    
        }
    
        if (threeLoadErr) {
    
            pushLog('warn', [threeLoadErr]);
    
        }
    
    
    
        try {
    
            const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    
            const prelude = [
    
                '"use strict";',
    
                'const fetch = undefined, XMLHttpRequest = undefined, WebSocket = undefined, EventSource = undefined;',
    
                'const alert = undefined, prompt = undefined, confirm = undefined;'
    
            ].join('\n');
    
    
    
            const executePromise = (async () => {
    
                let handledByExpr = false;
    
                const maybeExpr = String(runtimeCode || '').trim();
    
                if (maybeExpr && !/\breturn\b/.test(maybeExpr) && !/[;\n]/.test(maybeExpr)) {
    
                    try {
    
                        const exprFn = new AsyncFunction(
    
                            'context', 'console', 'THREE', 'Plot3D', 'importScripts',
    
                            `${prelude}\nreturn (${maybeExpr});`
    
                        );
    
                        await exprFn(localContext, consoleProxy, threeRef, plot3d, importScriptsProxy);
    
                        handledByExpr = true;
    
                    } catch (_) {
    
                        handledByExpr = false;
    
                    }
    
                }
    
                if (!handledByExpr) {
    
                    const fn = new AsyncFunction(
    
                        'context', 'console', 'THREE', 'Plot3D', 'importScripts',
    
                        `${prelude}\n${runtimeCode}`
    
                    );
    
                    await fn(localContext, consoleProxy, threeRef, plot3d, importScriptsProxy);
    
                }
    
            })();
    
    
    
            const timeout = normalizeClientJsTimeoutMs(timeoutMs, 5000);
    
            await Promise.race([
    
                executePromise,
    
                new Promise((_, reject) => setTimeout(() => reject(new Error(`canvas execution timeout after ${timeout}ms`)), timeout))
    
            ]);
    
    
    
            enforceCanvasDisplayAspect(canvas);
    
            if (statusEl) statusEl.textContent = logs.length ? `绘制完成 · ${logs.length} 条日志` : '绘制完成';
    
        } catch (err) {
    
            const msg = String((err && err.message) || err || 'canvas execute failed');
    
            enforceCanvasDisplayAspect(canvas);
    
            if (statusEl) statusEl.textContent = msg;
    
            card.classList.add('error');
    
        }
    
    }
    
    function maybeRenderCanvasFromJsExecuteResult(messageDiv, toolName, result, callId, toolIndex) {
    
        if (!messageDiv) return;
    
        if (!isClientJsExecToolName(toolName)) return;
    
        const state = ensureMessageCanvasState(messageDiv);
    
        if (!state) return;
    
    
    
        const parsedResult = parseJsonObjectMaybe(result);
    
        if (parsedResult && parsedResult.success === false) {
    
            return;
    
        }
    
        if (!parsedResult) {
    
            const resultText = String(result || '');
    
            if (/(^|\b)(error|failed|timeout|错误|失败)(\b|$)/i.test(resultText)) {
    
                return;
    
            }
    
        }
    
    
    
        let canvasMeta = null;
    
        const keys = buildCanvasLookupKeys(callId, toolIndex);
    
        for (const k of keys) {
    
            if (state.callInfoByKey[k]) {
    
                canvasMeta = state.callInfoByKey[k];
    
                break;
    
            }
    
        }
    
        if (!canvasMeta && parsedResult) {
    
            canvasMeta = findClientJsCanvasMetaFromResultPayload(parsedResult);
    
        }
    
        if (!canvasMeta || !canvasMeta.usedCanvas || !canvasMeta.code) {
    
            return;
    
        }
    
    
    
        let renderKey = keys[0] || '';
    
        if (!renderKey) {
    
            const reqId = parsedResult ? String(parsedResult.request_id || '').trim() : '';
    
            renderKey = reqId ? `req:${reqId}` : `anon_render:${state.nextSeq++}`;
    
        }
    
        if (state.renderedByKey[renderKey]) {
    
            return;
    
        }
    
        state.renderedByKey[renderKey] = true;
    
    
    
        const card = createToolCanvasCard(
    
            messageDiv,
    
            renderKey,
    
            canvasMeta.width,
    
            canvasMeta.height
    
        );
    
        if (!card) return;
    
        runCanvasCodeInCard(
    
            card,
    
            canvasMeta.code,
    
            canvasMeta.context || {},
    
            canvasMeta.timeoutMs
    
        );
    
        placeCanvasCardsBelowToolChain(messageDiv);
    
    }
    
    function buildClientJsWorkerSource() {
    
        return `
    
    const MAX_LOG_LINES = 120;
    
    const MAX_LOG_LEN = 480;
    
    
    
    function toText(v) {
    
      if (v === null || v === undefined) return String(v);
    
      if (typeof v === 'string') return v;
    
      try { return JSON.stringify(v); } catch (_) { return String(v); }
    
    }
    
    
    
    function clip(s) {
    
      const t = String(s || '');
    
      if (t.length <= MAX_LOG_LEN) return t;
    
      return t.slice(0, MAX_LOG_LEN) + '...';
    
    }
    
    
    
    function toJsonSafe(value) {
    
      try { JSON.stringify(value); return value; } catch (_) { return toText(value); }
    
    }
    
    
    
    self.addEventListener('message', async (ev) => {
    
      const data = (ev && ev.data && typeof ev.data === 'object') ? ev.data : {};
    
      const code = String(data.code || '');
    
      const context = (data.context && typeof data.context === 'object') ? data.context : {};
    
      const logs = [];
    
    
    
      const pushLog = (level, args) => {
    
        const line = '[' + level + '] ' + clip(Array.from(args || []).map((x) => toText(x)).join(' '));
    
        logs.push(line);
    
        if (logs.length > MAX_LOG_LINES) logs.splice(0, logs.length - MAX_LOG_LINES);
    
      };
    
    
    
      const consoleProxy = {
    
        log: (...args) => pushLog('log', args),
    
        info: (...args) => pushLog('info', args),
    
        warn: (...args) => pushLog('warn', args),
    
        error: (...args) => pushLog('error', args),
    
      };
    
    
    
      try {
    
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    
        const prelude = [
    
          '"use strict";',
    
          'const window = undefined, document = undefined, selfRef = undefined;',
    
          'const fetch = undefined, XMLHttpRequest = undefined, WebSocket = undefined, EventSource = undefined, importScripts = undefined;'
    
        ].join('\\n');
    
    
    
        let ret;
    
        let handledByExpr = false;
    
        const maybeExpr = String(code || '').trim();
    
        if (maybeExpr && !/\\breturn\\b/.test(maybeExpr) && !/[;\\n]/.test(maybeExpr)) {
    
          try {
    
            const exprFn = new AsyncFunction('context', 'console', prelude + '\\nreturn (' + maybeExpr + ');');
    
            ret = await exprFn(context, consoleProxy);
    
            handledByExpr = true;
    
          } catch (_) {
    
            handledByExpr = false;
    
          }
    
        }
    
    
    
        if (!handledByExpr) {
    
          const wrappedCode = [prelude, code].join('\\n');
    
          const fn = new AsyncFunction('context', 'console', wrappedCode);
    
          ret = await fn(context, consoleProxy);
    
        }
    
    
    
        self.postMessage({ success: true, result: toJsonSafe(ret), logs });
    
      } catch (err) {
    
        const msg = (err && err.stack) ? String(err.stack) : String(err || 'unknown error');
    
        if (/syntaxerror/i.test(msg)) {
    
          const preview = clip(String(code || '').replace(/\\s+/g, ' ').slice(0, 220));
    
          logs.push('[code_preview] ' + preview);
    
        }
    
        self.postMessage({ success: false, error: clip(msg), logs });
    
      }
    
    });
    
    `.trim();
    
    }
    
    async function executeClientJsInWorker(payload) {
    
        const p = (payload && typeof payload === 'object') ? payload : {};
    
        const rawCode = String(p.code || '');
    
        const code = normalizeClientJsCode(rawCode);
    
        const codeNormalized = code !== rawCode;
    
        const context = (p.context && typeof p.context === 'object') ? p.context : {};
    
        const timeoutMs = normalizeClientJsTimeoutMs(p.timeout_ms, 8000);
    
        if (!code.trim()) {
    
            return { success: false, error: 'missing code', logs: [], meta: { timeout_ms: timeoutMs } };
    
        }
    
    
    
        let worker = null;
    
        let objectUrl = '';
    
        const startedAt = Date.now();
    
        try {
    
            const blob = new Blob([buildClientJsWorkerSource()], { type: 'text/javascript' });
    
            objectUrl = URL.createObjectURL(blob);
    
            worker = new Worker(objectUrl);
    
        } catch (e) {
    
            if (objectUrl) URL.revokeObjectURL(objectUrl);
    
            return {
    
                success: false,
    
                error: `worker init failed: ${String((e && e.message) || e || '')}`,
    
                logs: [],
    
                meta: { timeout_ms: timeoutMs, code_normalized: codeNormalized }
    
            };
    
        }
    
    
    
        return await new Promise((resolve) => {
    
            let finished = false;
    
            const finish = (res) => {
    
                if (finished) return;
    
                finished = true;
    
                try { worker.terminate(); } catch (_) { /* ignore */ }
    
                if (objectUrl) URL.revokeObjectURL(objectUrl);
    
                const elapsed = Date.now() - startedAt;
    
                const out = (res && typeof res === 'object') ? res : {};
    
                out.meta = {
    
                    ...(out.meta || {}),
    
                    timeout_ms: timeoutMs,
    
                    duration_ms: elapsed,
    
                    code_normalized: codeNormalized
    
                };
    
                resolve(out);
    
            };
    
    
    
            const timer = setTimeout(() => {
    
                finish({
    
                    success: false,
    
                    error: `execution timeout after ${timeoutMs}ms`,
    
                    logs: []
    
                });
    
            }, timeoutMs);
    
    
    
            worker.addEventListener('message', (ev) => {
    
                clearTimeout(timer);
    
                const msg = (ev && ev.data && typeof ev.data === 'object') ? ev.data : {};
    
                finish({
    
                    success: !!msg.success,
    
                    result: msg.result,
    
                    error: String(msg.error || ''),
    
                    logs: Array.isArray(msg.logs) ? msg.logs : []
    
                });
    
            });
    
            worker.addEventListener('error', (ev) => {
    
                clearTimeout(timer);
    
                finish({
    
                    success: false,
    
                    error: String((ev && ev.message) || 'worker runtime error'),
    
                    logs: []
    
                });
    
            });
    
    
    
            try {
    
                worker.postMessage({ code, context });
    
            } catch (e) {
    
                clearTimeout(timer);
    
                finish({
    
                    success: false,
    
                    error: `worker postMessage failed: ${String((e && e.message) || e || '')}`,
    
                    logs: []
    
                });
    
            }
    
        });
    
    }

    function createClientToolController(deps = {}) {
        const getCurrentConversationId = requireToolCanvasDependency(deps, 'getCurrentConversationId');
        let clientToolPollTimer = null;
        let clientToolPollInFlight = false;
        let clientToolWssDraining = false;
        const clientToolWssQueue = [];
        const clientToolHandledRequestIds = new Set();
        let clientToolPollDelayMs = CLIENT_TOOL_POLL_MIN_MS;

        function rememberClientToolRequestId(requestId) {
            const rid = String(requestId || '').trim();
            if (!rid) return;
            clientToolHandledRequestIds.add(rid);
            if (clientToolHandledRequestIds.size <= 600) return;
            const it = clientToolHandledRequestIds.values();

            for (let i = 0; i < 200; i += 1) {
                const next = it.next();
                if (next.done) break;
                clientToolHandledRequestIds.delete(next.value);
            }
        }

        async function submitClientToolResult(conversationId, requestId, execRes) {
            const payload = {
                conversation_id: String(conversationId || '').trim(),
                request_id: String(requestId || '').trim(),
                exec_success: !!(execRes && execRes.success),
                result: execRes ? execRes.result : null,
                error: execRes ? String(execRes.error || '') : '',
                logs: (execRes && Array.isArray(execRes.logs)) ? execRes.logs : [],
                meta: (execRes && execRes.meta && typeof execRes.meta === 'object') ? execRes.meta : {}
            };
            const res = await fetch('/api/client-tools/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            return !!(data && data.success);
        }

        async function handleClientToolRequest(req, expectedConversationId = '') {
            if (!req || typeof req !== 'object') return 'idle';
            if (String(req.type || '').trim() !== 'js_execute') return 'idle';

            const currentConversationId = String(getCurrentConversationId() || '').trim();
            const conversationId = String(req.conversation_id || expectedConversationId || currentConversationId || '').trim();
            if (!conversationId) return 'no_conversation';
            if (expectedConversationId && conversationId !== String(expectedConversationId || '').trim()) return 'idle';
            if (currentConversationId && conversationId !== currentConversationId) return 'idle';

            const requestId = String(req.request_id || '').trim();
            if (!requestId) return 'idle';
            if (clientToolHandledRequestIds.has(requestId)) return 'idle';

            const reqPayload = (req.payload && typeof req.payload === 'object') ? req.payload : {};
            const canvasMeta = extractCanvasMetaFromJsPayload(reqPayload);
            let execRes = null;

            if (canvasMeta.usedCanvas) {
                rememberClientJsCanvasMeta(requestId, canvasMeta);
                execRes = {
                    success: true,
                    result: {
                        accepted: true,
                        mode: 'canvas',
                        message: 'canvas draw code received'
                    },
                    error: '',
                    logs: [],
                    meta: {
                        execution_mode: 'canvas',
                        canvas_used: true,
                        canvas_width: canvasMeta.width,
                        canvas_height: canvasMeta.height,
                        code_normalized: !!canvasMeta.codeNormalized
                    }
                };
            } else {
                execRes = await executeClientJsInWorker(reqPayload);
            }

            const submitted = await submitClientToolResult(conversationId, requestId, execRes);

            if (submitted) {
                rememberClientToolRequestId(requestId);
                return 'handled';
            }

            return 'idle';
        }

        async function drainClientToolWssQueue() {
            if (clientToolWssDraining) return;
            clientToolWssDraining = true;

            try {
                while (clientToolWssQueue.length > 0) {
                    const item = clientToolWssQueue.shift();
                    await handleClientToolRequest(item.req, item.conversationId);
                }
            } finally {
                clientToolWssDraining = false;
            }
        }

        function enqueueClientToolWssRequest(req, conversationId) {
            clientToolWssQueue.push({
                req,
                conversationId: String(conversationId || '').trim()
            });
            void drainClientToolWssQueue();
        }

        async function pollClientToolRequests() {
            if (clientToolPollInFlight) return 'in_flight';
            const conversationId = String(getCurrentConversationId() || '').trim();
            if (!conversationId) return 'no_conversation';
            clientToolPollInFlight = true;

            try {
                const res = await fetch('/api/client-tools/pull', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        conversation_id: conversationId,
                        wait_ms: CLIENT_TOOL_PULL_WAIT_MS
                    })
                });
                const data = await res.json();
                if (!data || !data.success || !data.request) return 'idle';
                return await handleClientToolRequest(data.request, conversationId);
            } catch (e) {
                // Long polling retries on the next scheduled tick; noisy logs make this path harder to inspect.
                return 'error';
            } finally {
                clientToolPollInFlight = false;
            }
        }

        function calcNextClientToolPollDelay(outcome) {
            const state = String(outcome || '').trim();
            if (state === 'handled') return CLIENT_TOOL_POLL_HIT_MS;
            if (state === 'no_conversation') return CLIENT_TOOL_POLL_NO_CONV_MS;
            if (state === 'error') return CLIENT_TOOL_POLL_ERROR_MS;
            if (state === 'in_flight') return Math.min(CLIENT_TOOL_POLL_MAX_MS, Math.max(CLIENT_TOOL_POLL_MIN_MS, clientToolPollDelayMs));

            if (state === 'idle') {
                const grown = Math.floor((Number(clientToolPollDelayMs || CLIENT_TOOL_POLL_MIN_MS) * 1.45));
                return Math.min(CLIENT_TOOL_POLL_MAX_MS, Math.max(CLIENT_TOOL_POLL_MIN_MS, grown));
            }

            return CLIENT_TOOL_POLL_MIN_MS;
        }

        function scheduleNextClientToolPoll(immediate = false) {
            if (clientToolPollTimer) {
                clearTimeout(clientToolPollTimer);
                clientToolPollTimer = null;
            }

            const waitMs = immediate ? 0 : Math.max(0, Number(clientToolPollDelayMs || CLIENT_TOOL_POLL_MIN_MS));
            clientToolPollTimer = setTimeout(async () => {
                const outcome = await pollClientToolRequests();
                clientToolPollDelayMs = calcNextClientToolPollDelay(outcome);
                scheduleNextClientToolPoll(false);
            }, waitMs);
        }

        function stopClientToolPolling() {
            if (clientToolPollTimer) {
                clearTimeout(clientToolPollTimer);
                clientToolPollTimer = null;
            }

            clientToolPollInFlight = false;
            clientToolWssQueue.length = 0;
            clientToolWssDraining = false;
            clientToolPollDelayMs = CLIENT_TOOL_POLL_MIN_MS;
        }

        function startClientToolPolling() {
            stopClientToolPolling();
            clientToolPollDelayMs = CLIENT_TOOL_POLL_MIN_MS;
        }

        return {
            rememberClientToolRequestId,
            submitClientToolResult,
            handleClientToolRequest,
            drainClientToolWssQueue,
            enqueueClientToolWssRequest,
            pollClientToolRequests,
            calcNextClientToolPollDelay,
            scheduleNextClientToolPoll,
            stopClientToolPolling,
            startClientToolPolling,
        };
    }

    getShared().registerModule(MODULE_NAME, {
        normalizeClientJsTimeoutMs,
        normalizeClientJsCode,
        parseJsonObjectMaybe,
        detectThreeUsageInJsCode,
        detectPlot3DUsageInJsCode,
        extractRequestedJsLibs,
        needsThreeJsForCanvas,
        needsPlot3DHelper,
        loadScriptByUrl,
        ensureClientJsThreeLoaded,
        createPlot3DHelper,
        enforceCanvasDisplayAspect,
        clampNumber,
        normalizeThreeTargetVector,
        createThreeOrbitController,
        detectCanvasUsageInJsCode,
        detect2DContextUsageInJsCode,
        normalizeCanvasDimension,
        extractCanvasMetaFromJsPayload,
        rememberClientJsCanvasMeta,
        findClientJsCanvasMetaFromResultPayload,
        parseJsExecuteArgumentsMeta,
        ensureMessageCanvasState,
        placeCanvasCardsBelowToolChain,
        buildCanvasLookupKeys,
        isClientJsExecToolName,
        rememberJsExecuteCanvasCall,
        createToolCanvasCard,
        runCanvasCodeInCard,
        maybeRenderCanvasFromJsExecuteResult,
        buildClientJsWorkerSource,
        executeClientJsInWorker,
        createClientToolController,
    });
})();
