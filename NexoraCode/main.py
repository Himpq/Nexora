"""
NexoraCode - 本地工具执行器
入口：系统托盘 + PyWebView 窗口

架构：
- 在 WebView 中直接打开 Nexora 前端（https://chat.himpqblog.cn），避免本地 HTML 黑屏问题
- 页面加载完成后通过 JS 注入 nexoracode_agent Cookie，并向服务器注册本地工具
- 工具执行：NexoraCode 主动向服务器长轮询 pending 请求 → 本地执行 → POST 结果回去
  （解决服务器无法反向连接用户 localhost 的问题）
"""

import json
import os
import threading
import time
import traceback
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

import requests
import webview

from core.server import start_local_server, LOCAL_PORT, set_shell_html, set_notes_shell_html
from core.tray import run_tray
from core.config import config, get_app_root
from core.tool_registry import ToolRegistry
from core import wintitle

# WebView2 持久化存储路径（保留 cookie / localStorage，避免每次重新登录）       
_STORAGE_PATH = get_app_root() / "webview_storage"

DEFAULT_NEXORA_URL = "https://chat.himpqblog.cn"
_STOP_POLL = threading.Event()
_POLL_STARTED = threading.Event()
_BOOTSTRAP_LOCK = threading.Lock()
_BOOTSTRAP_IN_FLIGHT = False
_NAV_STARTED = threading.Event()
_ASSET_WARM_STARTED = threading.Event()
_FIRST_LAYOUT_NUDGED = threading.Event()
_RUNTIME_STARTUP_ASSERTED = threading.Event()
_RUNTIME_STARTUP_ASSERT_LOCK = threading.Lock()
_ASSET_MANIFEST_PATH = get_app_root() / "asset_manifest.json"
_PENDING_TOAST_LOCK = threading.Lock()
_PENDING_TOAST_MESSAGE = ""
_NOTES_TRACE = str(config.get("notes_trace", True)).strip().lower() not in {"0", "false", "off", "no"}
_AUTH_TRACE_HEARTBEAT = str(config.get("auth_trace_heartbeat", False)).strip().lower() in {"1", "true", "on", "yes"}


def _notes_log(msg: str):
    if not _NOTES_TRACE:
        return
    try:
        ts = time.strftime("%H:%M:%S")
        print(f"[NexoraNotes {ts}] {msg}")
    except Exception:
        pass


def _append_webview2_arg(arg: str) -> None:
    val = str(arg or "").strip()
    if not val:
        return
    raw = str(os.environ.get("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "") or "").strip()
    parts = [p for p in raw.split(" ") if p]
    if val in parts:
        return
    parts.append(val)
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = " ".join(parts)

_EARLY_PAGE_ACCEL_JS = r"""(function() {
    const DOC_BOOT_LOG = '[NexoraDocBoot]';
    const AUTH_LOG = '[NexoraAuth]';
    const IN_IFRAME = (window.top !== window.self);
    const AGENT_TOKEN = __NC_AGENT_TOKEN__;
    const AUTH_TRACE = __NC_AUTH_TRACE__;
    const AUTH_TRACE_HEARTBEAT = __NC_AUTH_TRACE_HEARTBEAT__;
    const AUTH_BUFFER = [];

    function tryFlushAuthBuffer() {
        try {
            const api = window.pywebview && window.pywebview.api;
            if (!api || !api.log_auth_trace) return;
            while (AUTH_BUFFER.length) {
                const msg = AUTH_BUFFER.shift();
                try { api.log_auth_trace(String(msg || '')); } catch (_) {}
            }
        } catch (_) {}
    }

    function forwardAuthLog(msg) {
        try {
            const line = String(msg || '');
            const api = window.pywebview && window.pywebview.api;
            if (api && api.log_auth_trace) {
                try { api.log_auth_trace(line); } catch (_) { AUTH_BUFFER.push(line); }
            } else {
                AUTH_BUFFER.push(line);
            }
        } catch (_) {}
    }

    function authLog(msg) {
        if (!AUTH_TRACE) return;
        try {
            const line = AUTH_LOG + ' ' + String(msg || '');
            console.log(line);
            forwardAuthLog(line);
        } catch (_) {}
    }

    function injectAgentCookie() {
        try {
            const token = String(AGENT_TOKEN || '').trim();
            if (!token) return;
            const href = String((location && location.href) || '');
            if (!/^https?:\/\//i.test(href)) return;
            const value = encodeURIComponent(token);
            document.cookie = 'nexoracode_agent=' + value + '; path=/; SameSite=None; Secure';
            document.cookie = 'nexoracode_agent=' + value + '; path=/; SameSite=Lax';
            try { console.log(DOC_BOOT_LOG + ' cookie injected href=' + href); } catch (_) {}
            authLog('cookie injected href=' + href + ' len=' + String((document.cookie || '').length));
        } catch (_) {}
    }

    function installAuthTrace() {
        if (!AUTH_TRACE) return;
        if (window.__ncAuthTraceInstalled) return;
        window.__ncAuthTraceInstalled = true;

        authLog('trace install href=' + String((location && location.href) || '') + ' iframe=' + String(IN_IFRAME));

        document.addEventListener('submit', function(e) {
            try {
                const form = e && e.target;
                if (!form || !form.querySelector) return;
                const hasPwd = !!form.querySelector('input[type="password"]');
                if (!hasPwd) return;
                const action = String(form.getAttribute('action') || '');
                authLog('form submit action=' + action + ' cookieLen=' + String((document.cookie || '').length));
            } catch (_) {}
        }, true);

        document.addEventListener('click', function(e) {
            try {
                const el = e && e.target && e.target.closest ? e.target.closest('button,input[type="submit"],a,[role="button"]') : null;
                if (!el) return;
                const text = String((el.innerText || el.textContent || el.value || '')).toLowerCase();
                if (!/login|sign\s*in|log\s*in|\u767b\u5f55|\u767b\u5165/.test(text)) return;
                authLog('login click text=' + text.slice(0, 48));
            } catch (_) {}
        }, true);

        try {
            if (!window.__ncFetchPatched && window.fetch) {
                window.__ncFetchPatched = true;
                const rawFetch = window.fetch;
                window.fetch = function() {
                    let url = '';
                    let method = 'GET';
                    try {
                        const req = arguments[0];
                        const init = arguments[1] || {};
                        if (typeof req === 'string') {
                            url = req;
                        } else if (req && req.url) {
                            url = String(req.url || '');
                            method = String(req.method || method);
                        }
                        if (init && init.method) method = String(init.method || method);
                    } catch (_) {}
                    authLog('fetch -> ' + method + ' ' + url);
                    return rawFetch.apply(this, arguments).then(function(resp) {
                        try { authLog('fetch <- ' + String(resp.status) + ' ' + url); } catch (_) {}
                        return resp;
                    }).catch(function(err) {
                        try { authLog('fetch !! ' + url + ' err=' + String(err || '')); } catch (_) {}
                        throw err;
                    });
                };
            }
        } catch (_) {}

        try {
            if (!window.__ncXhrPatched && window.XMLHttpRequest) {
                window.__ncXhrPatched = true;
                const open = window.XMLHttpRequest.prototype.open;
                const send = window.XMLHttpRequest.prototype.send;
                window.XMLHttpRequest.prototype.open = function(method, url) {
                    try {
                        this.__ncMethod = String(method || 'GET');
                        this.__ncUrl = String(url || '');
                    } catch (_) {}
                    return open.apply(this, arguments);
                };
                window.XMLHttpRequest.prototype.send = function() {
                    try {
                        const m = String(this.__ncMethod || 'GET');
                        const u = String(this.__ncUrl || '');
                        authLog('xhr -> ' + m + ' ' + u);
                        this.addEventListener('loadend', function() {
                            try { authLog('xhr <- ' + String(this.status) + ' ' + u); } catch (_) {}
                        });
                    } catch (_) {}
                    return send.apply(this, arguments);
                };
            }
        } catch (_) {}

        if (AUTH_TRACE_HEARTBEAT) {
            setInterval(function() {
                try {
                    const href = String((location && location.href) || '');
                    const hasSession = /session|token|auth|nexoracode_agent/i.test(String(document.cookie || ''));
                    authLog('heartbeat href=' + href + ' cookieLen=' + String((document.cookie || '').length) + ' hasSession=' + String(hasSession));
                } catch (_) {}
            }, 2500);
        }
    }

    function ensureChildPywebviewBridge() {
        if (window.top === window.self) return;
        try {
            if (!window.pywebview && window.parent && window.parent.pywebview) {
                window.pywebview = window.parent.pywebview;
                try { console.log(DOC_BOOT_LOG + ' bridge proxied from parent'); } catch (_) {}
            }
        } catch (_) {}
    }

    function ensureHead() {
        if (document.head) return true;
        if (!document.documentElement) return false;
        const h = document.createElement('head');
        document.documentElement.insertBefore(h, document.documentElement.firstChild);
        return true;
    }

    function ensureDocBootOverlay() {
        if (!document.body) return false;
        let wrap = document.getElementById('nc-doc-boot-wrap');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'nc-doc-boot-wrap';
            wrap.innerHTML = '<div id="nc-doc-boot-stage"><div id="nc-doc-brand">Nexora<span class="dot"></span></div></div>';
            document.body.appendChild(wrap);
        }
        return true;
    }

    function ensureDocBootStyle() {
        if (!ensureHead()) return false;
        let s = document.getElementById('nc-doc-boot-style');
        if (!s) {
            s = document.createElement('style');
            s.id = 'nc-doc-boot-style';
            document.head.appendChild(s);
        }
        s.textContent = [
            '#nc-doc-boot-wrap{position:fixed;left:0;right:0;top:36px;bottom:0;overflow:hidden;display:none;align-items:center;justify-content:center;background:#050505;z-index:2147483646;pointer-events:none;}',
            '#nc-doc-boot-wrap.nc-visible{display:flex;}',
            '#nc-doc-boot-stage{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;}',
            '#nc-doc-brand{font-size:84px;font-weight:700;color:#ffffff;letter-spacing:-4px;display:flex;align-items:baseline;z-index:10;text-shadow:0 10px 30px rgba(0,0,0,0.5);animation:ncDocBootFadeIn 1.2s ease-out;line-height:1;}',
            '#nc-doc-brand .dot{color:#444;margin-left:4px;display:inline-flex;min-width:84px;}',
            '#nc-doc-brand .dot::after{content:".";animation:ncDocBootDots 4.5s infinite;display:inline-block;}',
            '@keyframes ncDocBootFadeIn{from{opacity:0;transform:translateY(20px);filter:blur(10px);}to{opacity:1;transform:translateY(0);filter:blur(0);}}',
            '@keyframes ncDocBootDots{0%{content:".";opacity:1;}5%{content:".";opacity:0;}10%{content:".";opacity:1;}15%{content:".";opacity:0;}20%{content:".";opacity:1;}22%{content:".";opacity:1;}33%{content:"..";opacity:1;}44%{content:"...";opacity:1;}55%{content:"...?";opacity:1;}77%{content:"...?";opacity:1;}80%{content:"..";opacity:1;}85%{content:".";opacity:1;}90%{content:"";opacity:1;}100%{content:".";opacity:1;}}'
        ].join('');
        return true;
    }

    function showDocBoot(reason) {
        try {
            ensureDocBootStyle();
            if (!ensureDocBootOverlay()) return false;
            const wrap = document.getElementById('nc-doc-boot-wrap');
            if (!wrap) return false;
            wrap.classList.add('nc-visible');
            wrap.setAttribute('data-reason', String(reason || ''));
            try { console.log(DOC_BOOT_LOG + ' show reason=' + String(reason || '')); } catch (_) {}
            return true;
        } catch (_) {
            return false;
        }
    }

    function hideDocBoot(reason) {
        try {
            const wrap = document.getElementById('nc-doc-boot-wrap');
            if (!wrap) return false;
            wrap.classList.remove('nc-visible');
            wrap.setAttribute('data-hide-reason', String(reason || ''));
            try { console.log(DOC_BOOT_LOG + ' hide reason=' + String(reason || '')); } catch (_) {}
            return true;
        } catch (_) {
            return false;
        }
    }

    window.__ncShowDocBoot = showDocBoot;
    window.__ncHideDocBoot = hideDocBoot;
    window.addEventListener('pywebviewready', function() { tryFlushAuthBuffer(); });
    setTimeout(tryFlushAuthBuffer, 0);
    setTimeout(tryFlushAuthBuffer, 120);
    setTimeout(tryFlushAuthBuffer, 500);
    installAuthTrace();
    injectAgentCookie();
    ensureChildPywebviewBridge();
    setTimeout(ensureChildPywebviewBridge, 0);
    setTimeout(ensureChildPywebviewBridge, 120);
    setTimeout(ensureChildPywebviewBridge, 500);
    setTimeout(injectAgentCookie, 0);
    setTimeout(injectAgentCookie, 120);
    setTimeout(injectAgentCookie, 500);

    // Guard against white flash during login -> app navigation.
    function ensureAntiFlashStyle() {
        try {
            if (!document.documentElement) return;
            document.documentElement.style.backgroundColor = '#050505';
        } catch (_) {}
        try {
            if (document.body) {
                document.body.style.backgroundColor = '#050505';
            }
        } catch (_) {}
        if (!ensureHead()) return;
        let s = document.getElementById('nc-anti-flash-style');
        if (!s) {
            s = document.createElement('style');
            s.id = 'nc-anti-flash-style';
            document.head.appendChild(s);
        }
        s.textContent = 'html,body{background:#050505 !important;}';
    }

    // Make external Google font styles non-render-blocking.
    function tuneLink(link) {
        try {
            if (!link) return;
            const rel = String(link.getAttribute('rel') || '').toLowerCase();
            const href = String(link.getAttribute('href') || '').toLowerCase();
            if (rel !== 'stylesheet') return;
            if (!(href.includes('fonts.googleapis.com') || href.includes('fonts.gstatic.com') || href.includes('gstatic.com'))) return;
            if (link.dataset && link.dataset.ncNonBlocking === '1') return;
            if (link.dataset) link.dataset.ncNonBlocking = '1';
            link.media = 'print';
            link.onload = function() { this.media = 'all'; };
            setTimeout(function() { try { link.media = 'all'; } catch (_) {} }, 2500);
        } catch (_) {}
    }

    function patchExisting() {
        try {
            ensureAntiFlashStyle();
            ensureDocBootStyle();
            ensureDocBootOverlay();
            document.querySelectorAll('link[rel="stylesheet"][href*="google"], link[rel="stylesheet"][href*="gstatic"]').forEach(tuneLink);
        } catch (_) {}
    }

    function observeNewLinks() {
        try {
            const root = document.documentElement || document;
            const mo = new MutationObserver(function(mutations) {
                for (const m of mutations || []) {
                    for (const node of (m.addedNodes || [])) {
                        try {
                            if (!node || node.nodeType !== 1) continue;
                            if (node.tagName === 'LINK') {
                                tuneLink(node);
                            }
                            if (node.querySelectorAll) {
                                node.querySelectorAll('link[rel="stylesheet"]').forEach(tuneLink);
                            }
                        } catch (_) {}
                    }
                }
            });
            mo.observe(root, { childList: true, subtree: true });
        } catch (_) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectAgentCookie, { once: true });
        document.addEventListener('DOMContentLoaded', patchExisting, { once: true });
        document.addEventListener('readystatechange', function() {
            if (document.readyState === 'interactive' || document.readyState === 'complete') {
                patchExisting();
            }
        });
    } else {
        patchExisting();
    }

    if (!IN_IFRAME) {
        showDocBoot('doc-start');
        document.addEventListener('DOMContentLoaded', function() { showDocBoot('dom-content-loaded'); }, { once: true });
        window.addEventListener('beforeunload', function() { showDocBoot('beforeunload'); }, true);
    }

    observeNewLinks();
    setTimeout(patchExisting, 0);
    setTimeout(patchExisting, 120);
    setTimeout(ensureChildPywebviewBridge, 900);
    if (!IN_IFRAME) {
        setTimeout(function() { showDocBoot('t+0'); }, 0);
        setTimeout(function() { showDocBoot('t+80'); }, 80);
    }
})();"""


def _resolve_window_mode() -> str:
    mode = str(config.get("window_mode", "") or "").strip().lower()
    force_frameless = str(config.get("force_frameless_borderless", True)).strip().lower() in {"1", "true", "on", "yes"}
    if force_frameless and mode == "custom":
        # In local proxy + custom titlebar workflow, prefer borderless to avoid native frame leftovers.
        return "frameless"
    if mode in {"native", "frameless", "custom"}:
        return mode
    # 兼容旧配置
    return "frameless" if bool(config.get("window_frameless", False)) else "native"


_WINDOW_MODE = _resolve_window_mode()
_USE_FRAMELESS = (_WINDOW_MODE == "frameless")
_USE_CUSTOM_TITLEBAR = (_WINDOW_MODE in {"frameless", "custom"})
_PERSISTENT_OUTER_SHELL = str(config.get("persistent_outer_shell", True)).strip().lower() in {"1", "true", "on", "yes"}
# Render a lightweight bootstrap document first for any custom titlebar mode,
# then navigate to real URL after native frame hooks are stable.
_USE_BOOTSTRAP_SHELL = _USE_CUSTOM_TITLEBAR

_BOOTSTRAP_HTML = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>NexoraCode</title>
<style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050505;color:#aaa;font-family:'Segoe UI','Microsoft YaHei',sans-serif;}
    #nc-boot-bar{position:fixed;top:0;left:0;right:0;height:36px;background:#050505;display:flex;align-items:center;justify-content:flex-end;z-index:99;user-select:none;-webkit-app-region:drag;}
    .nc-btb-btns{display:flex;align-items:center;gap:0;height:100%;-webkit-app-region:no-drag;}
    .nb{width:46px;height:100%;border:none;background:transparent;color:rgba(255,255,255,.55);display:flex;align-items:center;justify-content:center;padding:0;margin:0;box-sizing:border-box;line-height:1;-webkit-app-region:no-drag;cursor:default;}
    .nb:hover{background:rgba(255,255,255,.10);color:#fff;}
    .nb.close:hover{background:#e81123;color:#fff;}
    .nb svg{pointer-events:none;display:block;}
    .nc-boot-rsz{position:fixed;z-index:120;pointer-events:auto;background:transparent;-webkit-app-region:no-drag;}
    .nc-boot-rsz.edge-top{top:0;left:10px;right:10px;height:8px;cursor:ns-resize;}
    .nc-boot-rsz.edge-bottom{bottom:0;left:10px;right:10px;height:8px;cursor:ns-resize;}
    .nc-boot-rsz.edge-left{left:0;top:10px;bottom:10px;width:8px;cursor:ew-resize;}
    .nc-boot-rsz.edge-right{right:0;top:10px;bottom:10px;width:8px;cursor:ew-resize;}
    .nc-boot-rsz.corner-tl{top:0;left:0;width:12px;height:12px;cursor:nwse-resize;}
    .nc-boot-rsz.corner-tr{top:0;right:0;width:12px;height:12px;cursor:nesw-resize;}
    .nc-boot-rsz.corner-bl{bottom:0;left:0;width:12px;height:12px;cursor:nesw-resize;}
    .nc-boot-rsz.corner-br{bottom:0;right:0;width:12px;height:12px;cursor:nwse-resize;}
    #nc-shell-frame{position:fixed;top:36px;left:0;right:0;bottom:0;background:#050505;z-index:1;}
    #nc-shell-iframe{position:absolute;inset:0;width:100%;height:100%;border:none;outline:none;background:#050505;display:block;}
        #nc-boot-stage{position:fixed;left:0;right:0;top:36px;bottom:0;overflow:hidden;display:flex;align-items:center;justify-content:center;z-index:50;background:#050505;}
        #nc-boot-center{display:flex;flex-direction:column;align-items:center;gap:14px;min-width:340px;max-width:min(560px,92vw);}
        #nc-brand{font-size:84px;font-weight:700;color:#ffffff;letter-spacing:-4px;display:flex;align-items:baseline;z-index:10;text-shadow:0 10px 30px rgba(0,0,0,0.5);animation:fadeInLogo 1.2s ease-out;line-height:1;}
        #nc-boot-sub{color:rgba(255,255,255,0.72);font-size:13px;letter-spacing:.3px;}
        #nc-boot-progress{width:min(420px,86vw);height:6px;background:rgba(255,255,255,0.12);border-radius:999px;overflow:hidden;}
        #nc-boot-progress-bar{height:100%;width:0%;background:linear-gradient(90deg,#8ea8ff,#f5f8ff);transition:width .18s ease;}
        #nc-boot-resource{color:rgba(255,255,255,0.5);font-size:12px;max-width:min(560px,90vw);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    @keyframes fadeInLogo{from{opacity:0;transform:translateY(20px);filter:blur(10px);}to{opacity:1;transform:translateY(0);filter:blur(0);}}
    #nc-brand .dot{color:#444;margin-left:4px;display:inline-flex;min-width:84px;}
    #nc-brand .dot::after{content:".";animation:multiPhaseDots 4.5s infinite;display:inline-block;}
        @keyframes multiPhaseDots {
            0%   { content: "."; opacity: 1; }
            5%   { content: "."; opacity: 0; }
            10%  { content: "."; opacity: 1; }
            15%  { content: "."; opacity: 0; }
            20%  { content: "."; opacity: 1; }
            22%  { content: "."; opacity: 1; }
            33%  { content: ".."; opacity: 1; }
            44%  { content: "..."; opacity: 1; }
            55%  { content: "...?"; opacity: 1; }
            77%  { content: "...?"; opacity: 1; }
            80%  { content: ".."; opacity: 1; }
            85%  { content: "."; opacity: 1; }
            90%  { content: ""; opacity: 1; }
            100% { content: "."; opacity: 1; }
        }
</style>
</head>
<body>
<div id="nc-boot-bar"><div class="nc-btb-btns"><button class="nb" data-act="settings" title="\u8bbe\u7f6e"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06 .06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.8 1 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button><button class="nb" data-act="min" title="最小化"><svg width="10" height="10" viewBox="0 0 10 1"><rect width="10" height="1" y="0" fill="currentColor"/></svg></button><button class="nb" data-act="max" title="最大化" id="nc-boot-max-btn"><svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg></button><button class="nb close" data-act="close" title="关闭"><svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg></button></div></div>
<div id="nc-boot-resize-grips"><div class="nc-boot-rsz edge-top" data-edge="top"></div><div class="nc-boot-rsz edge-bottom" data-edge="bottom"></div><div class="nc-boot-rsz edge-left" data-edge="left"></div><div class="nc-boot-rsz edge-right" data-edge="right"></div><div class="nc-boot-rsz corner-tl" data-edge="top-left"></div><div class="nc-boot-rsz corner-tr" data-edge="top-right"></div><div class="nc-boot-rsz corner-bl" data-edge="bottom-left"></div><div class="nc-boot-rsz corner-br" data-edge="bottom-right"></div></div>
<div id="nc-shell-frame"><iframe id="nc-shell-iframe" referrerpolicy="strict-origin-when-cross-origin" allow="clipboard-read; clipboard-write"></iframe></div>
<div id="nc-boot-stage">
    <div id="nc-boot-center">
      <div id="nc-brand">Nexora<span class="dot"></span></div>
      <div id="nc-boot-sub">加载中</div>
      <div id="nc-boot-progress"><div id="nc-boot-progress-bar"></div></div>
      <div id="nc-boot-resource">初始化窗口...</div>
    </div>
</div>
<script>
(function() {
    const WINDOW_MODE = "__NC_WINDOW_MODE__";
    const ENTRY_URL = __NC_ENTRY_URL__;
    const AUTO_ESCAPE_LOGIN_LOOP = __NC_AUTO_ESCAPE_IFRAME_LOGIN_LOOP__;
    const AUTH_TRACE_HEARTBEAT = __NC_AUTH_TRACE_HEARTBEAT__;
    const RESIZE_ENABLED = WINDOW_MODE !== 'native';
    const EDGE_CURSOR = {
        'top': 'ns-resize',
        'bottom': 'ns-resize',
        'left': 'ew-resize',
        'right': 'ew-resize',
        'top-left': 'nwse-resize',
        'top-right': 'nesw-resize',
        'bottom-left': 'nesw-resize',
        'bottom-right': 'nwse-resize'
    };
    let ready = !!(window.pywebview && window.pywebview.api);
    let bootMaximized = false;
    let bootProgress = 6;
    let bootTimer = null;
    function api() {
        return (window.pywebview && window.pywebview.api) ? window.pywebview.api : null;
    }

    function traceAuth(msg) {
        try {
            const line = '[NexoraAuth] ' + String(msg || '');
            const a = api();
            if (a && a.log_auth_trace) {
                a.log_auth_trace(line);
            }
            try { console.log(line); } catch (_) {}
        } catch (_) {}
    }

    function requestLocalAgentRegister(reason) {
        try {
            const seen = [];
            const fns = [
                window.__ncAttemptLocalAgentRegister,
                window.parent && window.parent.__ncAttemptLocalAgentRegister,
                window.top && window.top.__ncAttemptLocalAgentRegister
            ];
            for (let i = 0; i < fns.length; i += 1) {
                const fn = fns[i];
                if (typeof fn !== 'function') continue;
                if (seen.indexOf(fn) >= 0) continue;
                seen.push(fn);
                try {
                    fn(String(reason || ''));
                    return true;
                } catch (_) {}
            }
        } catch (_) {}
        return false;
    }

    let _ncLoginLoopHits = 0;
    let _ncLoginFallbackSent = false;
    let _ncSawChatOnce = false;
    let _ncLoopDiagnosed = false;
    function _ncToTopLevelUrl(raw) {
        try {
            const u = new URL(String(raw || ENTRY_URL || ''));
            u.searchParams.delete('nc_iframe_content');
            return u.toString();
        } catch (_) {
            return String(raw || ENTRY_URL || '');
        }
    }
    function _ncMaybeEscapeLoginLoop(reason, href) {
        if (!AUTO_ESCAPE_LOGIN_LOOP) {
            return;
        }
        if (_ncLoginFallbackSent) return;
        const h = String(href || '');
        if (!/\\/login([?#]|$)/i.test(h)) return;
        _ncLoginLoopHits += 1;
        traceAuth('login-loop-hit reason=' + String(reason || '') + ' count=' + String(_ncLoginLoopHits));
        if (_ncLoginLoopHits < 2) return;
        const target = _ncToTopLevelUrl(h || ENTRY_URL);
        const a = api();
        if (a && a.escape_iframe_login_loop) {
            _ncLoginFallbackSent = true;
            traceAuth('trigger top-level login fallback target=' + target);
            try { a.escape_iframe_login_loop(target); } catch (_) {}
        }
    }

    function setBootProgress(p) {
        const bar = document.getElementById('nc-boot-progress-bar');
        if (!bar) return;
        const v = Math.max(0, Math.min(100, Number(p) || 0));
        bar.style.width = v + '%';
    }

    function setBootResource(text) {
        const el = document.getElementById('nc-boot-resource');
        if (!el) return;
        el.textContent = String(text || '加载中...');
    }

    function startBootProgress() {
        if (bootTimer) return;
        setBootProgress(bootProgress);
        bootTimer = setInterval(function() {
            bootProgress = Math.min(94, bootProgress + Math.max(0.4, (96 - bootProgress) * 0.045));
            setBootProgress(bootProgress);
        }, 180);
    }

    function completeBootProgress(text) {
        if (text) setBootResource(text);
        if (bootTimer) {
            clearInterval(bootTimer);
            bootTimer = null;
        }
        bootProgress = 100;
        setBootProgress(100);
    }
    const bar = document.getElementById('nc-boot-bar');
    const shellIframe = document.getElementById('nc-shell-iframe');
    startBootProgress();
    setBootResource('初始化窗口与容器...');
    traceAuth('bootstrap shell script running href=' + String((location && location.href) || ''));

    function hideBootStage(reason) {
        const stage = document.getElementById('nc-boot-stage');
        if (!stage) return;
        stage.style.opacity = '0';
        stage.style.transition = 'opacity .18s ease';
        setTimeout(function() { stage.style.display = 'none'; }, 200);
        if (reason) setBootResource(String(reason));
    }

    function initShellIframe() {
        if (!shellIframe) return;
        if (String(shellIframe.getAttribute('src') || '')) return;
        shellIframe.setAttribute('src', String(ENTRY_URL || 'about:blank'));
        traceAuth('iframe src set=' + String(ENTRY_URL || 'about:blank'));
        setBootResource('正在加载结构与资源...');

        shellIframe.addEventListener('load', function() {
            completeBootProgress('页面已加载');
            setTimeout(function() {
                hideBootStage('页面已就绪');
            }, 600);
            requestLocalAgentRegister('iframe-load');
            traceAuth('iframe load event fired');
            try {
                const href = String((shellIframe.contentWindow && shellIframe.contentWindow.location && shellIframe.contentWindow.location.href) || '');
                traceAuth('iframe href=' + href);
            } catch (e) {
                traceAuth('iframe href read blocked (expected cross-origin): ' + String(e || ''));}
            try {
                const c = String((shellIframe.contentWindow && shellIframe.contentWindow.document && shellIframe.contentWindow.document.cookie) || '');
                traceAuth('iframe cookie len=' + String(c.length));
            } catch (e) {
                traceAuth('iframe cookie read blocked (expected cross-origin): ' + String(e || ''));}

            try {
                const cw = shellIframe.contentWindow;
                const cd = shellIframe.contentDocument;
                if (cw && cd) {
                    const install = function() {
                        try {
                            if (cw.__ncAuthAssistInstalled) return;
                            cw.__ncAuthAssistInstalled = true;
                            traceAuth('iframe auth assist installed');
                            cw.addEventListener('unload', function() {
                                try {
                                    const stage = document.getElementById('nc-boot-stage');
                                    if (stage) {
                                        stage.style.display = 'flex';
                                        void stage.offsetHeight;
                                        stage.style.opacity = '1';
                                        const bb = document.getElementById('nc-boot-resource');
                                        if (bb) bb.textContent = '页面跳转中...';
                                        // Reset progress for the next page
                                        bootProgress = 10;
                                        startBootProgress();
                                    }
                                } catch(e) {}
                            });

                            const probeCookie = function(tag) {
                                try {
                                    const k = 'nc_probe_' + String(Date.now());
                                    cd.cookie = k + '=1; path=/';
                                    const ok = String(cd.cookie || '').indexOf(k + '=1') >= 0;
                                    traceAuth('iframe cookie probe(' + tag + ') ok=' + String(ok) + ' len=' + String((cd.cookie || '').length));
                                    if (ok) {
                                        requestLocalAgentRegister('cookie-probe-' + tag);
                                    }
                                    if (!ok) {
                                        let hrefNow = '';
                                        try { hrefNow = String((cw.location && cw.location.href) || ''); } catch (_) {}
                                        _ncMaybeEscapeLoginLoop('cookie-probe-' + tag, hrefNow);
                                    }
                                } catch (e) {
                                    traceAuth('iframe cookie probe(' + tag + ') failed: ' + String(e || ''));
                                }
                            };

                            const stripGoogleFonts = function(tag) {
                                try {
                                    const nodes = cd.querySelectorAll('link[rel="stylesheet"][href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]');
                                    let n = 0;
                                    nodes.forEach(function(el) {
                                        try { el.remove(); n += 1; } catch (_) {}
                                    });
                                    if (n > 0) traceAuth('iframe strip google fonts count=' + String(n) + ' tag=' + String(tag || ''));
                                } catch (e) {
                                    traceAuth('iframe strip google fonts failed tag=' + String(tag || '') + ' err=' + String(e || ''));
                                }
                            };

                            const requestStorage = function(tag) {
                                try {
                                    if (!cd.requestStorageAccess) {
                                        traceAuth('requestStorageAccess unavailable tag=' + tag);
                                        return;
                                    }
                                    cd.requestStorageAccess().then(function() {
                                        traceAuth('requestStorageAccess granted tag=' + tag);
                                        requestLocalAgentRegister('storage-access-' + tag);
                                        probeCookie('after-storage-access-' + tag);
                                    }).catch(function(err) {
                                        traceAuth('requestStorageAccess denied tag=' + tag + ' err=' + String(err || ''));
                                    });
                                } catch (e) {
                                    traceAuth('requestStorageAccess error tag=' + tag + ' err=' + String(e || ''));
                                }
                            };

                            probeCookie('load');
                            stripGoogleFonts('load');
                            requestStorage('load');

                            cd.addEventListener('click', function() {
                                requestStorage('click');
                                stripGoogleFonts('click');
                            }, true);

                            cd.addEventListener('submit', function(ev) {
                                try {
                                    const form = ev && ev.target;
                                    const action = form && form.getAttribute ? String(form.getAttribute('action') || '') : '';
                                    const hasPwd = !!(form && form.querySelector && form.querySelector('input[type="password"]'));
                                    traceAuth('iframe form submit action=' + action + ' hasPwd=' + String(hasPwd));
                                } catch (_) {}
                                requestStorage('submit');
                                probeCookie('submit');
                                stripGoogleFonts('submit');
                            }, true);

                            traceAuth('iframe network monkeypatch disabled to avoid URL rebasing');

                            if (AUTH_TRACE_HEARTBEAT) {
                                setInterval(function() {
                                    try {
                                        const href = String((cw.location && cw.location.href) || '');
                                        const ck = String(cd.cookie || '');
                                        traceAuth('iframe heartbeat href=' + href + ' cookieLen=' + String(ck.length));
                                        if (/\\/chat([?#]|$)/i.test(href)) {
                                            _ncSawChatOnce = true;
                                        }
                                        if (_ncSawChatOnce && /\\/login([?#]|$)/i.test(href) && String(ck.length) === '0' && !_ncLoopDiagnosed) {
                                            _ncLoopDiagnosed = true;
                                            traceAuth('diagnose: chat->login redirect loop with cookieLen=0; likely third-party iframe auth cookie rejected by server SameSite policy');
                                            traceAuth('action: set server auth/session cookie SameSite=None; Secure OR disable persistent_outer_shell for first-party login');
                                        }
                                        if (/\\/login([?#]|$)/i.test(href) && String(ck.length) === '0') {
                                            _ncMaybeEscapeLoginLoop('heartbeat-cookie-zero', href);
                                        }
                                        stripGoogleFonts('heartbeat');
                                    } catch (e) {
                                        traceAuth('iframe heartbeat failed: ' + String(e || ''));
                                    }
                                }, 3000);
                            }
                        } catch (e) {
                            traceAuth('iframe auth assist install failed: ' + String(e || ''));
                        }
                    };
                    install();
                }
            } catch (e) {
                traceAuth('iframe auth assist outer failed: ' + String(e || ''));
            }
        });
        setTimeout(function() {
            setBootResource('网络较慢，继续加载中...');
        }, 2800);
    }
    setTimeout(initShellIframe, 200);
    if (AUTH_TRACE_HEARTBEAT) {
        setInterval(function() {
            try {
                traceAuth('bootstrap heartbeat cookieLen=' + String((document.cookie || '').length));
            } catch (e) {
                traceAuth('bootstrap heartbeat cookie read failed: ' + String(e || ''));
            }
        }, 3000);
    }
    document.addEventListener('readystatechange', function() {
        const st = String(document.readyState || '');
        if (st === 'interactive') {
            setBootResource('准备页面上下文...');
            bootProgress = Math.max(bootProgress, 34);
            setBootProgress(bootProgress);
        } else if (st === 'complete') {
            completeBootProgress('等待页面加载...');
        }
    });

    if (bar) {
        let down = null;
        let lastDownTs = 0;
        let lastDownX = 0;
        let lastDownY = 0;
        let skipNativeDbl = false;
        bar.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            if (e.target && e.target.closest && e.target.closest('button')) return;
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const near = Math.abs((e.clientX || 0) - lastDownX) + Math.abs((e.clientY || 0) - lastDownY) <= 8;
            const isDouble = (now - lastDownTs) <= 300 && near;
            lastDownTs = now;
            lastDownX = (e.clientX || 0);
            lastDownY = (e.clientY || 0);
            if (isDouble) {
                skipNativeDbl = true;
                down = null;
                const a = api();
                if (a && a.maximize_window) a.maximize_window();
                setBootResource('应用窗口状态...');
                return;
            }
            down = { x: e.clientX || 0, y: e.clientY || 0, started: false };
            const onMove = function(ev) {
                if (!down || down.started) return;
                const dx = Math.abs((ev.clientX || 0) - down.x);
                const dy = Math.abs((ev.clientY || 0) - down.y);
                if (dx + dy < 4) return;
                down.started = true;
                const a = api();
                if (a && a.start_window_drag) a.start_window_drag();
                setBootResource('准备页面加载...');
            };
            const onUp = function() {
                window.removeEventListener('mousemove', onMove, true);
                window.removeEventListener('mouseup', onUp, true);
                down = null;
            };
            window.addEventListener('mousemove', onMove, true);
            window.addEventListener('mouseup', onUp, true);
        });
        bar.addEventListener('dblclick', function(e) {
            if (e.target && e.target.closest && e.target.closest('button')) return;
            if (skipNativeDbl) {
                skipNativeDbl = false;
                e.preventDefault();
                return;
            }
            const a = api();
            if (a && a.maximize_window) a.maximize_window();
        });
    }

    document.querySelectorAll('#nc-boot-bar button[data-act]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const a = api();
            if (!a) return;
            const act = String(btn.getAttribute('data-act') || '');
            if (act === 'settings' && a.open_settings) a.open_settings();
            else if (act === 'min' && a.minimize_window) a.minimize_window();
            else if (act === 'max' && a.maximize_window) {
                a.maximize_window();
                setBootResource('应用窗口状态...');
                bootMaximized = !bootMaximized;
                applyBootResizeState();
            }
            else if (act === 'close' && a.close_window) a.close_window();
        });
    });

    function applyBootResizeState() {
        const wrap = document.getElementById('nc-boot-resize-grips');
        if (!wrap) return;
        if (!RESIZE_ENABLED) {
            wrap.style.display = 'none';
            return;
        }
        wrap.style.display = '';
        wrap.querySelectorAll('[data-edge]').forEach(function(el) {
            const edge = String(el.getAttribute('data-edge') || '').trim();
            if (bootMaximized) {
                el.style.pointerEvents = 'none';
                el.style.cursor = 'default';
            } else {
                el.style.pointerEvents = 'auto';
                el.style.cursor = EDGE_CURSOR[edge] || 'default';
            }
        });
    }

    window._ncTitlebarSetMaximized = function(isMax) {
        bootMaximized = !!isMax;
        applyBootResizeState();
    };

    if (RESIZE_ENABLED) {
        document.querySelectorAll('#nc-boot-resize-grips [data-edge]').forEach(function(el) {
            el.addEventListener('mousedown', function(e) {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                const edge = String(el.getAttribute('data-edge') || '').trim();
                const a = api();
                if (!a || !a.start_window_resize) return;
                if (bootMaximized) {
                    return;
                }
                a.start_window_resize(edge);
            });
        });
    }
    applyBootResizeState();

    window.addEventListener('pywebviewready', function() {
        ready = true;
        bootProgress = Math.max(bootProgress, 58);
        setBootProgress(bootProgress);
        setBootResource('连接本地桥接...');
    });
    if (!ready) {
        let bootChecks = 0;
        const t = setInterval(function() {
            bootChecks += 1;
            if (window.pywebview && window.pywebview.api) {
                ready = true;
                clearInterval(t);
                return;
            }
            if (bootChecks >= 80) {
                clearInterval(t);
            }
        }, 50);
    }
})();
</script>
</body>
</html>
"""

_BOOTSTRAP_HTML_MODE = _BOOTSTRAP_HTML.replace("__NC_WINDOW_MODE__", _WINDOW_MODE)
_NOTES_BOOTSTRAP_HTML_MODE = (
    _BOOTSTRAP_HTML_MODE
    .replace("<title>NexoraCode</title>", "<title>Nexora Notes</title>")
    .replace("start_window_resize", "start_notes_window_resize")
    .replace("start_window_drag", "start_notes_window_drag")
    .replace("is_window_maximized", "is_notes_window_maximized")
    .replace("minimize_window", "minimize_notes_window")
    .replace("maximize_window", "maximize_notes_window")
    .replace("close_window", "close_notes_window")
    .replace("__NC_AUTO_ESCAPE_IFRAME_LOGIN_LOOP__", "false")
)
_SETTINGS_BOOTSTRAP_HTML_MODE = (
    _BOOTSTRAP_HTML_MODE
    .replace("<title>NexoraCode</title>", "<title>Nexora Settings</title>")
    .replace('data-act="settings"', 'data-act="noop" style="display:none" aria-hidden="true"')
    .replace("start_window_resize", "start_settings_window_resize")
    .replace("start_window_drag", "start_settings_window_drag")
    .replace("minimize_window", "minimize_settings_window")
    .replace("maximize_window", "maximize_settings_window")
    .replace("close_window", "close_settings_window")
    .replace("__NC_AUTO_ESCAPE_IFRAME_LOGIN_LOOP__", "false")
)
class NexoraWindowApi:
    """暴露给页面 JS 的本地窗口控制 API。"""

    def __init__(self):
        self._window = None
        self._maximized = False
        self._runtime_base_url = DEFAULT_NEXORA_URL
        self._notes_window = None
        self._notes_window_lock = threading.Lock()
        self._notes_pinned = bool(config.get("notes_window_pinned", False))
        self._notes_titlebar_js = ""
        self._settings_window = None
        self._settings_window_lock = threading.Lock()

    def bind(self, window, runtime_base_url: str | None = None):
        self._window = window
        if runtime_base_url:
            self._runtime_base_url = str(runtime_base_url).strip() or DEFAULT_NEXORA_URL

    def log_auth_trace(self, message=""):
        try:
            ts = time.strftime("%H:%M:%S")
            msg = str(message or "").strip()
            if len(msg) > 800:
                msg = msg[:800] + "..."
            print(f"[NexoraAuthTrace {ts}] {msg}")
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def escape_iframe_login_loop(self, url=""):
        if not self._window:
            return {"success": False, "message": "window not found"}
        target = str(url or "").strip()
        if not target:
            target = _build_entry_url(self._runtime_base_url)
        try:
            print(f"[NexoraShell] escape iframe login loop -> top-level url={target}")
        except Exception:
            pass
        try:
            self._window.load_url(target)
            return {"success": True, "url": target}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def _get_notes_window(self):
        with self._notes_window_lock:
            nw = self._notes_window
        if nw and nw in webview.windows:
            return nw
        return None

        def _build_notes_prefill_startup_js_v2(self) -> str:
                if not self._window:
                        return "(function(){})();"
                styles = []
                links = []
                try:
                        out = self._window.evaluate_js("""(function() {
    try {
        const iframe = document.getElementById('nc-app-iframe');
        const doc = (iframe && iframe.contentDocument) ? iframe.contentDocument : document;
        const origin = String((location && location.origin) || '');
        const ret = { styles: [], links: [] };

        const styleNodes = Array.from(doc.querySelectorAll('style'));
        for (const s of styleNodes) {
            const txt = String(s.textContent || '').trim();
            if (!txt) continue;
            const low = txt.toLowerCase();
            if (!(low.includes('note') || low.includes('companion') || low.includes('sidebar') || low.includes('app-container'))) continue;
            ret.styles.push(txt.slice(0, 60000));
            if (ret.styles.length >= 16) break;
        }

        const linkNodes = Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'));
        for (const l of linkNodes) {
            let href = '';
            try { href = new URL(String(l.getAttribute('href') || ''), doc.location.href).href; } catch (_) { href = ''; }
            if (!href) continue;
            if (origin && !href.startsWith(origin)) continue;
            ret.links.push(href);
            if (ret.links.length >= 16) break;
        }

        return ret;
    } catch (_) {
        return { styles: [], links: [] };
    }
})();""")
                        if isinstance(out, dict):
                                raw_styles = out.get("styles") if isinstance(out.get("styles"), list) else []
                                raw_links = out.get("links") if isinstance(out.get("links"), list) else []
                                styles = [str(x or "") for x in raw_styles if str(x or "").strip()]
                                links = [str(x or "") for x in raw_links if str(x or "").strip()]
                except Exception:
                        pass

                payload_styles = json.dumps(styles, ensure_ascii=False)
                payload_links = json.dumps(links, ensure_ascii=False)
                return f"""(function() {{
    const PREFILL_STYLES = {payload_styles};
    const PREFILL_LINKS = {payload_links};
    function ensureHead() {{
        if (document.head) return true;
        if (!document.documentElement) return false;
        const h = document.createElement('head');
        document.documentElement.insertBefore(h, document.documentElement.firstChild);
        return true;
    }}
    function applyPrefill() {{
        if (!ensureHead()) return;
        try {{
            if (document.documentElement) document.documentElement.style.backgroundColor = '#050505';
            if (document.body) document.body.style.backgroundColor = '#050505';
        }} catch (_) {{}}
        for (const href of PREFILL_LINKS) {{
            try {{
                if (!href) continue;
                const l = document.createElement('link');
                l.rel = 'stylesheet';
                l.href = href;
                document.head.appendChild(l);
            }} catch (_) {{}}
        }}
        let idx = 0;
        for (const txt of PREFILL_STYLES) {{
            try {{
                if (!txt) continue;
                const s = document.createElement('style');
                s.id = 'nc-notes-prefill-style-v2-' + String(idx++);
                s.textContent = txt;
                document.head.appendChild(s);
            }} catch (_) {{}}
        }}
    }}
    applyPrefill();
    setTimeout(applyPrefill, 0);
    setTimeout(applyPrefill, 80);
}})();"""

        def _extract_notes_bundle_from_main(self) -> dict:
                if not self._window:
                        return {"styles": [], "links": []}
                try:
                        out = self._window.evaluate_js("""(function() {
    try {
        const iframe = document.getElementById('nc-app-iframe');
        const doc = (iframe && iframe.contentDocument) ? iframe.contentDocument : document;
        const origin = String((location && location.origin) || '');
        const ret = { styles: [], links: [] };
        const styles = Array.from(doc.querySelectorAll('style'));
        for (const s of styles) {
            const txt = String(s.textContent || '').trim();
            if (!txt) continue;
            const low = txt.toLowerCase();
            if (!(low.includes('note') || low.includes('companion') || low.includes('sidebar') || low.includes('app-container'))) continue;
            ret.styles.push(txt.slice(0, 60000));
            if (ret.styles.length >= 16) break;
        }
        const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'));
        for (const l of links) {
            let href = '';
            try { href = new URL(String(l.getAttribute('href') || ''), doc.location.href).href; } catch (_) { href = ''; }
            if (!href) continue;
            if (origin && !href.startsWith(origin)) continue;
            ret.links.push(href);
            if (ret.links.length >= 16) break;
        }
        return ret;
    } catch (_) {
        return { styles: [], links: [] };
    }
})();""")
                        if isinstance(out, dict):
                                styles = out.get("styles") if isinstance(out.get("styles"), list) else []
                                links = out.get("links") if isinstance(out.get("links"), list) else []
                                return {
                                        "styles": [str(x or "") for x in styles if str(x or "").strip()],
                                        "links": [str(x or "") for x in links if str(x or "").strip()],
                                }
                except Exception:
                        pass
                return {"styles": [], "links": []}

        def _build_notes_prefill_startup_js(self) -> str:
                bundle = self._extract_notes_bundle_from_main()
                styles = bundle.get("styles") if isinstance(bundle.get("styles"), list) else []
                links = bundle.get("links") if isinstance(bundle.get("links"), list) else []
                payload_styles = json.dumps(styles, ensure_ascii=False)
                payload_links = json.dumps(links, ensure_ascii=False)
                return f"""(function() {{
    const PREFILL_STYLES = {payload_styles};
    const PREFILL_LINKS = {payload_links};
    function ensureHead() {{
        if (document.head) return true;
        if (!document.documentElement) return false;
        const h = document.createElement('head');
        document.documentElement.insertBefore(h, document.documentElement.firstChild);
        return true;
    }}
    function applyPrefill() {{
        if (!ensureHead()) return;
        try {{
            if (document.documentElement) document.documentElement.style.backgroundColor = '#050505';
            if (document.body) document.body.style.backgroundColor = '#050505';
        }} catch (_) {{}}
        for (const href of PREFILL_LINKS) {{
            try {{
                if (!href) continue;
                if (document.querySelector('link[rel="stylesheet"][href="' + href.replace(/"/g, '\\\\"') + '"]')) continue;
                const l = document.createElement('link');
                l.rel = 'stylesheet';
                l.href = href;
                document.head.appendChild(l);
            }} catch (_) {{}}
        }}
        let idx = 0;
        for (const txt of PREFILL_STYLES) {{
            try {{
                if (!txt) continue;
                const id = 'nc-notes-prefill-style-' + String(idx++);
                if (document.getElementById(id)) continue;
                const s = document.createElement('style');
                s.id = id;
                s.textContent = txt;
                document.head.appendChild(s);
            }} catch (_) {{}}
        }}
    }}
    applyPrefill();
    setTimeout(applyPrefill, 0);
    setTimeout(applyPrefill, 80);
}})();"""


    def _get_settings_window(self):
        with self._settings_window_lock:
            sw = self._settings_window
        if sw and sw in webview.windows:
            return sw
        return None

    def open_settings(self):
        try:
            with self._settings_window_lock:
                sw = self._settings_window
                if sw and sw in webview.windows:
                    try:
                        if hasattr(sw, "restore"):
                            sw.restore()
                    except Exception:
                        pass
                    try:
                        if hasattr(sw, "show"):
                            sw.show()
                    except Exception:
                        pass
                    try:
                        if hasattr(sw, "bring_to_front"):
                            sw.bring_to_front()
                    except Exception:
                        pass
                    return {"success": True, "reused": True}

                settings_html_path = get_app_root() / "ui" / "settings_local.html"
                settings_html = settings_html_path.read_text(encoding="utf-8")

                try:
                    settings_w = int(config.get("settings_window_width", 900) or 900)
                    settings_h = int(config.get("settings_window_height", 640) or 640)
                except Exception:
                    settings_w, settings_h = 900, 640
                settings_w = max(700, min(1600, settings_w))
                settings_h = max(520, min(1400, settings_h))

                settings_kwargs = {
                    "title": "Nexora Settings",
                    "html": settings_html,
                    "width": settings_w,
                    "height": settings_h,
                    "min_size": (700, 520),
                    "resizable": True,
                    "frameless": _USE_FRAMELESS,
                    "text_select": True,
                    "js_api": self,
                    "easy_drag": False,
                    "background_color": "#0c0c0f",
                }
                try:
                    settings_window = webview.create_window(**settings_kwargs)
                except TypeError:
                    fallback = dict(settings_kwargs)
                    fallback.pop("frameless", None)
                    try:
                        settings_window = webview.create_window(**fallback)
                    except TypeError:
                        fallback.pop("js_api", None)
                        settings_window = webview.create_window(**fallback)

                self._settings_window = settings_window
                _settings_shown_fired = [False]

                def _settings_on_shown():
                    if _settings_shown_fired[0]:
                        return
                    _settings_shown_fired[0] = True
                    try:
                        wintitle.install(settings_window, emulate_snap=_USE_FRAMELESS)
                    except Exception:
                        pass
                    try:
                        wintitle.ensure_resizable_frame(settings_window)
                    except Exception:
                        pass
                    if _USE_FRAMELESS:
                        def _apply_frameless():
                            time.sleep(0.06)
                            try:
                                wintitle.enforce_borderless_chrome(settings_window)
                                wintitle.force_frame_refresh(settings_window)
                            except Exception:
                                pass
                        threading.Thread(target=_apply_frameless, daemon=True).start()

                def _settings_on_loaded():
                    if _USE_FRAMELESS:
                        return

                    def _apply_custom():
                        for _ in range(30):
                            try:
                                if wintitle.enable_custom_chrome(settings_window):
                                    wintitle.force_frame_refresh(settings_window)
                                    break
                            except Exception:
                                pass
                            time.sleep(0.03)
                        try:
                            wintitle.ensure_resizable_frame(settings_window)
                            wintitle.force_frame_refresh(settings_window)
                        except Exception:
                            pass

                    if _WINDOW_MODE == "custom":
                        threading.Thread(target=_apply_custom, daemon=True).start()

                def _settings_on_closed():
                    with self._settings_window_lock:
                        if self._settings_window is settings_window:
                            self._settings_window = None

                settings_window.events.shown += _settings_on_shown
                settings_window.events.loaded += _settings_on_loaded
                settings_window.events.closed += _settings_on_closed
                threading.Thread(target=_settings_on_shown, daemon=True).start()
                return {"success": True, "reused": False}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def close_window(self):
        _STOP_POLL.set()
        try:
            with self._notes_window_lock:
                nw = self._notes_window
                self._notes_window = None
            with self._settings_window_lock:
                sw = self._settings_window
                self._settings_window = None
            if nw:
                try:
                    nw.destroy()
                except Exception:
                    pass
            if sw:
                try:
                    sw.destroy()
                except Exception:
                    pass
            if self._window:
                self._window.destroy()
        except Exception:
            pass
        return {"success": True}

    def minimize_window(self):
        try:
            if self._window:
                if not wintitle.minimize_window(self._window):
                    self._window.minimize()
        except Exception:
            pass
        return {"success": True}

    def maximize_window(self):
        """最大化；若已最大化则恢复（Windows 标准行为）"""
        t0 = time.perf_counter()
        try:
            if self._window:
                # 优先走原生 HWND 切换，避免 frameless 下 state 同步不及时
                if not wintitle.toggle_max_restore(self._window):
                    try:
                        st = str(self._window.state).lower()
                    except Exception:
                        st = ""
                    if st == "maximized":
                        self._window.restore()
                    else:
                        self._window.maximize()
        except Exception:
            try:
                st = str(self._window.state).lower() if self._window else ""
                if self._window:
                    if st == "maximized":
                        self._window.restore()
                    else:
                        self._window.maximize()
            except Exception:
                pass
        try:
            dt_ms = (time.perf_counter() - t0) * 1000.0
            print(f"[NexoraUI] maximize_window done in {dt_ms:.2f}ms")
        except Exception:
            pass
        return {"success": True}

    def titlebar_double_click(self):
        """标题栏双击：优先走原生 NCLBUTTONDBLCLK，体验更接近系统窗口。"""
        try:
            if self._window and wintitle.titlebar_double_click(self._window):
                return {"success": True}
        except Exception:
            pass
        return self.maximize_window()

    def start_window_drag(self):
        """由标题栏 JS 触发，调用原生非客户区拖拽。"""
        try:
            if self._window:
                wintitle.start_window_drag(self._window)
        except Exception:
            pass
        return {"success": True}

    def start_window_resize(self, edge="right"):
        try:
            if self._window:
                ok = bool(wintitle.start_window_resize(self._window, edge=edge))
                return {"success": ok}
        except Exception:
            pass
        return {"success": False}

    def get_preferred_model(self):
        model_id = str(config.get("preferred_model_id", "") or "").strip()
        return {"success": True, "model_id": model_id}

    def set_preferred_model(self, model_id: str = ""):
        next_id = str(model_id or "").strip()
        prev = str(config.get("preferred_model_id", "") or "").strip()
        if next_id != prev:
            config.set("preferred_model_id", next_id)
        return {"success": True}

    def is_window_maximized(self):
        try:
            if self._window:
                return {"success": True, "maximized": bool(wintitle.is_window_maximized(self._window))}
        except Exception:
            pass
        return {"success": True, "maximized": False}

    def sync_window_state(self):
        try:
            if self._window:
                wintitle.sync_max_state(self._window)
        except Exception:
            pass
        return {"success": True}

    def snap_window(self, mode: str = "max"):
        try:
            if self._window:
                ok = bool(wintitle.snap_window(self._window, mode=mode))
                return {"success": ok}
        except Exception:
            pass
        return {"success": False}

    def close_notes_window(self):
        try:
            with self._notes_window_lock:
                nw = self._notes_window
                self._notes_window = None
            if nw:
                try:
                    nw.destroy()
                except Exception:
                    pass
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def minimize_notes_window(self):
        nw = self._get_notes_window()
        if not nw:
            return {"success": False, "message": "notes window not found"}
        try:
            if not wintitle.minimize_window(nw):
                nw.minimize()
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def maximize_notes_window(self):
        nw = self._get_notes_window()
        if not nw:
            return {"success": False, "message": "notes window not found"}
        try:
            if not wintitle.toggle_max_restore(nw):
                try:
                    st = str(nw.state).lower()
                except Exception:
                    st = ""
                if st == "maximized":
                    nw.restore()
                else:
                    nw.maximize()
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def start_notes_window_drag(self):
        nw = self._get_notes_window()
        if not nw:
            return {"success": False, "message": "notes window not found"}
        try:
            wintitle.start_window_drag(nw)
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def start_notes_window_resize(self, edge="right"):
        nw = self._get_notes_window()
        if not nw:
            return {"success": False, "message": "notes window not found"}
        try:
            ok = bool(wintitle.start_window_resize(nw, edge=edge))
            return {"success": ok}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def is_notes_window_maximized(self):
        nw = self._get_notes_window()
        if not nw:
            return {"success": True, "maximized": False}
        try:
            return {"success": True, "maximized": bool(wintitle.is_window_maximized(nw))}
        except Exception:
            return {"success": True, "maximized": False}

    def sync_notes_window_state(self):
        nw = self._get_notes_window()
        if not nw:
            return {"success": False, "message": "notes window not found"}
        try:
            wintitle.sync_max_state(nw)
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def is_notes_window_pinned(self):
        return {"success": True, "pinned": bool(self._notes_pinned)}

    def toggle_notes_pin(self):
        nw = self._get_notes_window()
        self._notes_pinned = not bool(self._notes_pinned)
        config.set("notes_window_pinned", bool(self._notes_pinned))
        try:
            if nw:
                wintitle.set_window_topmost(nw, bool(self._notes_pinned))
        except Exception:
            pass
        return {"success": True, "pinned": bool(self._notes_pinned)}

    def set_notes_window_bounds(self, width=0, height=0):
        try:
            w = int(width or 0)
            h = int(height or 0)
        except Exception:
            return {"success": False, "message": "invalid bounds"}
        w = max(360, min(1800, w))
        h = max(460, min(1800, h))
        config.set("notes_window_width", w)
        config.set("notes_window_height", h)
        return {"success": True, "width": w, "height": h}

    def close_settings_window(self):
        try:
            with self._settings_window_lock:
                sw = self._settings_window
                self._settings_window = None
            if sw:
                try:
                    sw.destroy()
                except Exception:
                    pass
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def minimize_settings_window(self):
        sw = self._get_settings_window()
        if not sw:
            return {"success": False, "message": "settings window not found"}
        try:
            if not wintitle.minimize_window(sw):
                sw.minimize()
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def maximize_settings_window(self):
        sw = self._get_settings_window()
        if not sw:
            return {"success": False, "message": "settings window not found"}
        try:
            if not wintitle.toggle_max_restore(sw):
                try:
                    st = str(sw.state).lower()
                except Exception:
                    st = ""
                if st == "maximized":
                    sw.restore()
                else:
                    sw.maximize()
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def start_settings_window_drag(self):
        sw = self._get_settings_window()
        if not sw:
            return {"success": False, "message": "settings window not found"}
        try:
            wintitle.start_window_drag(sw)
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def start_settings_window_resize(self, edge="right"):
        sw = self._get_settings_window()
        if not sw:
            return {"success": False, "message": "settings window not found"}
        try:
            ok = bool(wintitle.start_window_resize(sw, edge=edge))
            return {"success": ok}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def is_settings_window_maximized(self):
        sw = self._get_settings_window()
        if not sw:
            return {"success": True, "maximized": False}
        try:
            return {"success": True, "maximized": bool(wintitle.is_window_maximized(sw))}
        except Exception:
            return {"success": True, "maximized": False}

    def sync_settings_window_state(self):
        sw = self._get_settings_window()
        if not sw:
            return {"success": False, "message": "settings window not found"}
        try:
            wintitle.sync_max_state(sw)
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def set_settings_window_bounds(self, width=0, height=0):
        try:
            w = int(width or 0)
            h = int(height or 0)
        except Exception:
            return {"success": False, "message": "invalid bounds"}
        w = max(700, min(1600, w))
        h = max(520, min(1400, h))
        config.set("settings_window_width", w)
        config.set("settings_window_height", h)
        return {"success": True, "width": w, "height": h}

    def get_local_settings_snapshot(self):
        try:
            return {"success": True, "data": config.snapshot()}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def save_local_settings_snapshot(self, payload=None):
        try:
            data = payload if isinstance(payload, dict) else {}
            config.replace_all(data)
            return {"success": True, "data": config.snapshot()}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def jump_note_source_external(self, payload=None):
        if not self._window:
            return {"success": False, "message": "main window not found"}
        src = payload if isinstance(payload, dict) else {}
        req = {
            "anchor": src.get("anchor") if isinstance(src.get("anchor"), dict) else None,
            "sourceTitle": str(src.get("sourceTitle", "") or "").strip(),
        }
        try:
            js_payload = json.dumps(req, ensure_ascii=False)
            ok = self._window.evaluate_js(
                f"""(function(){{
    function resolveView() {{
        const ids = ['nc-app-iframe', 'nc-shell-iframe'];
        for (const id of ids) {{
            const frame = document.getElementById(id);
            if (frame && frame.contentWindow) {{
                return frame.contentWindow;
            }}
        }}
        const frames = Array.from(document.querySelectorAll('iframe'));
        for (const frame of frames) {{
            try {{
                const src = String(frame.getAttribute('src') || frame.src || '');
                if ((/nc_iframe_content=1/i.test(src) || /\\/chat([?#]|$)/i.test(src)) && frame.contentWindow) {{
                    return frame.contentWindow;
                }}
            }} catch (_) {{}}
        }}
        return window;
    }}
    try {{
        const view = resolveView();
        if (view && typeof view.__nexoraJumpToNoteAnchor === 'function') {{
            view.__nexoraJumpToNoteAnchor({js_payload});
            return true;
        }}
    }} catch (_) {{}}
    return false;
}})();"""
            )
            if str(ok).lower() not in {"true", "1"}:
                return {"success": False, "message": "main jump handler not ready"}
            try:
                if hasattr(self._window, "restore"):
                    self._window.restore()
            except Exception:
                pass
            try:
                if hasattr(self._window, "show"):
                    self._window.show()
            except Exception:
                pass
            try:
                if hasattr(self._window, "bring_to_front"):
                    self._window.bring_to_front()
            except Exception:
                pass
            return {"success": True}
        except Exception as e:
            return {"success": False, "message": str(e)}

        def get_notes_snapshot(self):
                if not self._window:
                        return {"success": False, "html": "", "message": "main window not found"}
                try:
                        out = self._window.evaluate_js("""(function() {
    try {
        const iframe = document.getElementById('nc-app-iframe');
        const doc = (iframe && iframe.contentDocument) ? iframe.contentDocument : document;
        const panel = doc.querySelector('#notesPanel, .notes-panel, [id*="notes" i][class*="panel" i], [class*="notes" i]');
        if (!panel) {
            return { success: false, html: '', message: 'notes panel not found', href: String((doc.location && doc.location.href) || '') };
        }
        return {
            success: true,
            html: String(panel.outerHTML || ''),
            href: String((doc.location && doc.location.href) || ''),
            title: String((doc.title || '') || ''),
            ts: Date.now(),
        };
    } catch (e) {
        return { success: false, html: '', message: String(e || 'snapshot error') };
    }
})();""")
                        if isinstance(out, dict):
                                return out
                except Exception as e:
                        return {"success": False, "html": "", "message": str(e)}
                return {"success": False, "html": "", "message": "snapshot empty"}

        def _extract_notes_bundle_from_main_for_prefill(self) -> dict:
                if not self._window:
                        return {"styles": [], "links": []}
                try:
                        out = self._window.evaluate_js("""(function() {
    try {
        const iframe = document.getElementById('nc-app-iframe');
        const doc = (iframe && iframe.contentDocument) ? iframe.contentDocument : document;
        const origin = String((location && location.origin) || '');
        const ret = { styles: [], links: [] };

        const styles = Array.from(doc.querySelectorAll('style'));
        for (const s of styles) {
            const txt = String(s.textContent || '').trim();
            if (!txt) continue;
            const low = txt.toLowerCase();
            if (!(low.includes('note') || low.includes('companion') || low.includes('sidebar') || low.includes('app-container'))) continue;
            ret.styles.push(txt.slice(0, 60000));
            if (ret.styles.length >= 16) break;
        }

        const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'));
        for (const l of links) {
            let href = '';
            try { href = new URL(String(l.getAttribute('href') || ''), doc.location.href).href; } catch (_) { href = ''; }
            if (!href) continue;
            if (origin && !href.startsWith(origin)) continue;
            ret.links.push(href);
            if (ret.links.length >= 16) break;
        }

        return ret;
    } catch (_) {
        return { styles: [], links: [] };
    }
})();""")
                        if isinstance(out, dict):
                                styles = out.get("styles") if isinstance(out.get("styles"), list) else []
                                links = out.get("links") if isinstance(out.get("links"), list) else []
                                return {
                                        "styles": [str(x or "") for x in styles if str(x or "").strip()],
                                        "links": [str(x or "") for x in links if str(x or "").strip()],
                                }
                except Exception:
                        pass
                return {"styles": [], "links": []}

        def _build_notes_prefill_startup_js(self) -> str:
                bundle = self._extract_notes_bundle_from_main_for_prefill()
                styles = bundle.get("styles") if isinstance(bundle.get("styles"), list) else []
                links = bundle.get("links") if isinstance(bundle.get("links"), list) else []
                payload_styles = json.dumps(styles, ensure_ascii=False)
                payload_links = json.dumps(links, ensure_ascii=False)
                return f"""(function() {{
    const PREFILL_STYLES = {payload_styles};
    const PREFILL_LINKS = {payload_links};
    function ensureHead() {{
        if (document.head) return true;
        if (!document.documentElement) return false;
        const h = document.createElement('head');
        document.documentElement.insertBefore(h, document.documentElement.firstChild);
        return true;
    }}
    function applyPrefill() {{
        if (!ensureHead()) return;
        try {{
            if (document.documentElement) document.documentElement.style.backgroundColor = '#050505';
            if (document.body) document.body.style.backgroundColor = '#050505';
        }} catch (_) {{}}
        for (const href of PREFILL_LINKS) {{
            try {{
                if (!href) continue;
                const l = document.createElement('link');
                l.rel = 'stylesheet';
                l.href = href;
                document.head.appendChild(l);
            }} catch (_) {{}}
        }}
        let idx = 0;
        for (const txt of PREFILL_STYLES) {{
            try {{
                if (!txt) continue;
                const s = document.createElement('style');
                s.id = 'nc-notes-prefill-style-' + String(idx++);
                s.textContent = txt;
                document.head.appendChild(s);
            }} catch (_) {{}}
        }}
    }}
    applyPrefill();
    setTimeout(applyPrefill, 0);
    setTimeout(applyPrefill, 80);
}})();"""

    def get_notes_snapshot(self):
        if not self._window:
            return {"success": False, "html": "", "message": "main window not found"}
        try:
            out = self._window.evaluate_js("""(function() {
    try {
        function resolveDoc() {
            const ids = ['nc-app-iframe', 'nc-shell-iframe'];
            for (const id of ids) {
                const frame = document.getElementById(id);
                if (frame && frame.contentDocument) {
                    return { doc: frame.contentDocument, frameId: id };
                }
            }
            const frames = Array.from(document.querySelectorAll('iframe'));
            for (const frame of frames) {
                try {
                    const src = String(frame.getAttribute('src') || frame.src || '');
                    if ((/nc_iframe_content=1/i.test(src) || /\\/chat([?#]|$)/i.test(src)) && frame.contentDocument) {
                        return { doc: frame.contentDocument, frameId: String(frame.id || 'iframe') };
                    }
                } catch (_) {}
            }
            return { doc: document, frameId: 'document' };
        }
        const ctx = resolveDoc();
        const doc = ctx.doc || document;
        const view = doc.defaultView || null;
        try {
            if (view && typeof view.__nexoraGetNotesSnapshotHtml === 'function') {
                const helperOut = view.__nexoraGetNotesSnapshotHtml();
                if (helperOut && typeof helperOut === 'object') {
                    helperOut.frame = String(ctx.frameId || '');
                    helperOut.href = String((doc.location && doc.location.href) || '');
                    helperOut.title = String((doc.title || '') || '');
                    return helperOut;
                }
            }
        } catch (_) {}
        let panel = doc.querySelector('#notesPanel, .notes-panel, aside.notes-panel, div.notes-panel');
        try {
            if (view && typeof view.renderNotesList === 'function') {
                view.renderNotesList();
            }
        } catch (_) {}
        panel = doc.querySelector('#notesPanel, .notes-panel, aside.notes-panel, div.notes-panel');
        if (!panel) {
            const hint = doc.querySelector('[id*="notes" i], [class*="notes" i]');
            return {
                success: false,
                html: '',
                message: 'notes panel not found',
                hint: hint ? {
                    id: String(hint.id || ''),
                    className: String(hint.className || ''),
                    tagName: String(hint.tagName || '')
                } : null,
                frame: String(ctx.frameId || ''),
                href: String((doc.location && doc.location.href) || '')
            };
        }
        let htmlOut = String(panel.outerHTML || '');
        let itemsCount = -1;
        try {
            const cloned = panel.cloneNode(true);
            if (cloned && cloned.classList) {
                cloned.classList.add('active');
                cloned.classList.remove('closed');
                cloned.classList.remove('collapsed');
            }
            if (cloned && cloned.setAttribute) {
                cloned.setAttribute('aria-hidden', 'false');
            }
            const list = cloned && cloned.querySelector ? cloned.querySelector('#notesList, .notes-list') : null;
            itemsCount = list && list.children ? Number(list.children.length || 0) : -1;
            htmlOut = String((cloned && cloned.outerHTML) || htmlOut || '');
        } catch (_) {}
        return {
            success: true,
            html: htmlOut,
            href: String((doc.location && doc.location.href) || ''),
            title: String((doc.title || '') || ''),
            frame: String(ctx.frameId || ''),
            items_count: itemsCount,
            ts: Date.now(),
        };
    } catch (e) {
        return { success: false, html: '', message: String(e || 'snapshot error') };
    }
})();""")
            if isinstance(out, dict):
                return out
        except Exception as e:
            return {"success": False, "html": "", "message": str(e)}
        return {"success": False, "html": "", "message": "snapshot empty"}

    def _extract_notes_bundle_from_main_for_prefill(self) -> dict:
        if not self._window:
            return {"styles": [], "links": []}
        try:
            out = self._window.evaluate_js("""(function() {
    try {
        function resolveDoc() {
            const ids = ['nc-app-iframe', 'nc-shell-iframe'];
            for (const id of ids) {
                const frame = document.getElementById(id);
                if (frame && frame.contentDocument) {
                    return frame.contentDocument;
                }
            }
            const frames = Array.from(document.querySelectorAll('iframe'));
            for (const frame of frames) {
                try {
                    const src = String(frame.getAttribute('src') || frame.src || '');
                    if ((/nc_iframe_content=1/i.test(src) || /\\/chat([?#]|$)/i.test(src)) && frame.contentDocument) {
                        return frame.contentDocument;
                    }
                } catch (_) {}
            }
            return document;
        }
        const doc = resolveDoc();
        const origin = String((location && location.origin) || '');
        const ret = { styles: [], links: [] };

        const styles = Array.from(doc.querySelectorAll('style'));
        for (const s of styles) {
            const txt = String(s.textContent || '').trim();
            if (!txt) continue;
            const low = txt.toLowerCase();
            if (!(low.includes('note') || low.includes('companion') || low.includes('sidebar') || low.includes('app-container'))) continue;
            ret.styles.push(txt.slice(0, 60000));
            if (ret.styles.length >= 16) break;
        }

        const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]'));
        for (const l of links) {
            let href = '';
            try { href = new URL(String(l.getAttribute('href') || ''), doc.location.href).href; } catch (_) { href = ''; }
            if (!href) continue;
            if (origin && !href.startsWith(origin)) continue;
            ret.links.push(href);
            if (ret.links.length >= 16) break;
        }

        return ret;
    } catch (_) {
        return { styles: [], links: [] };
    }
})();""")
            if isinstance(out, dict):
                styles = out.get("styles") if isinstance(out.get("styles"), list) else []
                links = out.get("links") if isinstance(out.get("links"), list) else []
                return {
                    "styles": [str(x or "") for x in styles if str(x or "").strip()],
                    "links": [str(x or "") for x in links if str(x or "").strip()],
                }
        except Exception:
            pass
        return {"styles": [], "links": []}

    def _build_notes_prefill_startup_js(self) -> str:
        bundle = self._extract_notes_bundle_from_main_for_prefill()
        styles = bundle.get("styles") if isinstance(bundle.get("styles"), list) else []
        links = bundle.get("links") if isinstance(bundle.get("links"), list) else []
        payload_styles = json.dumps(styles, ensure_ascii=False)
        payload_links = json.dumps(links, ensure_ascii=False)
        return f"""(function() {{
    const PREFILL_STYLES = {payload_styles};
    const PREFILL_LINKS = {payload_links};
    function ensureHead() {{
        if (document.head) return true;
        if (!document.documentElement) return false;
        const h = document.createElement('head');
        document.documentElement.insertBefore(h, document.documentElement.firstChild);
        return true;
    }}
    function applyPrefill() {{
        if (!ensureHead()) return;
        try {{
            if (document.documentElement) document.documentElement.style.backgroundColor = '#050505';
            if (document.body) document.body.style.backgroundColor = '#050505';
        }} catch (_) {{}}
        for (const href of PREFILL_LINKS) {{
            try {{
                if (!href) continue;
                const l = document.createElement('link');
                l.rel = 'stylesheet';
                l.href = href;
                document.head.appendChild(l);
            }} catch (_) {{}}
        }}
        let idx = 0;
        for (const txt of PREFILL_STYLES) {{
            try {{
                if (!txt) continue;
                const s = document.createElement('style');
                s.id = 'nc-notes-prefill-style-' + String(idx++);
                s.textContent = txt;
                document.head.appendChild(s);
            }} catch (_) {{}}
        }}
    }}
    applyPrefill();
    setTimeout(applyPrefill, 0);
    setTimeout(applyPrefill, 80);
}})();"""

    def open_notes_companion(self):
        base = str(self._runtime_base_url or DEFAULT_NEXORA_URL).strip() or DEFAULT_NEXORA_URL
        url = _build_entry_url(base, {"notes_companion": "1"})
        notes_use_custom = True
        notes_shell_url = f"http://127.0.0.1:{LOCAL_PORT}/nc/notes-shell?_nc_ts={int(time.time() * 1000)}"
        _notes_log(f"open request url={url} mode={_WINDOW_MODE} frameless={_USE_FRAMELESS}")
        try:
            with self._notes_window_lock:
                # Reuse existing window if still alive.
                nw = self._notes_window
                if nw and nw in webview.windows:
                    _notes_log("reuse existing notes window")
                    try:
                        if hasattr(nw, "restore"):
                            nw.restore()
                    except Exception:
                        pass
                    try:
                        if hasattr(nw, "show"):
                            nw.show()
                    except Exception:
                        pass
                    try:
                        if hasattr(nw, "bring_to_front"):
                            nw.bring_to_front()
                    except Exception:
                        pass
                    try:
                        wintitle.set_window_topmost(nw, bool(config.get("notes_window_pinned", self._notes_pinned)))
                    except Exception:
                        pass
                    return {"success": True, "reused": True}

                try:
                    notes_w = int(config.get("notes_window_width", 480) or 480)
                    notes_h = int(config.get("notes_window_height", 760) or 760)
                except Exception:
                    notes_w, notes_h = 480, 760
                notes_w = max(360, min(1800, notes_w))
                notes_h = max(500, min(1800, notes_h))
                _notes_log(f"create notes window size={notes_w}x{notes_h}")

                notes_kwargs = {
                    "title": "Nexora Notes",
                    "url": url,
                    "width": notes_w,
                    "height": notes_h,
                    "min_size": (360, 500),
                    "resizable": True,
                    "frameless": _USE_FRAMELESS,
                    "text_select": True,
                    "js_api": self,
                }
                # For notes companion, always render bootstrap shell first in custom titlebar mode
                # to avoid first-frame black flash before page CSS is ready.
                if notes_use_custom:
                    _notes_bootstrap_html = _NOTES_BOOTSTRAP_HTML_MODE.replace("__NC_ENTRY_URL__", json.dumps(url, ensure_ascii=False))
                    _notes_bootstrap_html = _notes_bootstrap_html.replace(
                        "__NC_AUTH_TRACE_HEARTBEAT__",
                        "true" if _AUTH_TRACE_HEARTBEAT else "false",
                    )
                    set_notes_shell_html(_notes_bootstrap_html)
                    notes_kwargs["url"] = notes_shell_url
                    notes_kwargs.pop("html", None)
                    notes_kwargs["easy_drag"] = False
                    notes_kwargs["background_color"] = "#050505"
                try:
                    notes_window = webview.create_window(**notes_kwargs)
                    _notes_log("create_window success with primary kwargs")
                except TypeError:
                    _notes_log("create_window TypeError, fallback remove frameless")
                    fallback = dict(notes_kwargs)
                    fallback.pop("frameless", None)
                    try:
                        notes_window = webview.create_window(**fallback)
                        _notes_log("create_window success with fallback frameless removed")
                    except TypeError:
                        _notes_log("create_window TypeError again, fallback remove js_api")
                        fallback.pop("js_api", None)
                        notes_window = webview.create_window(**fallback)
                        _notes_log("create_window success with fallback js_api removed")
                self._notes_window = notes_window

                notes_titlebar_js = self._notes_titlebar_js or _build_notes_titlebar_js()
                self._notes_titlebar_js = notes_titlebar_js
                notes_prefill_js = "(function(){})();"
                try:
                    _prefill_builder = None
                    for _name in ("_build_notes_prefill_startup_js_v2", "_build_notes_prefill_startup_js"):
                        cand = getattr(self, _name, None)
                        if callable(cand):
                            _prefill_builder = cand
                            break
                    if _prefill_builder is not None:
                        notes_prefill_js = str(_prefill_builder() or "(function(){})();")
                        _notes_log(f"prefill builder used: {_prefill_builder.__name__}")
                    else:
                        _notes_log("prefill builder not found; fallback noop")
                except Exception as ex:
                    _notes_log(f"prefill builder failed: {ex}; fallback noop")
                _notes_shown_fired = [False]

                def _notes_on_shown():
                    if _notes_shown_fired[0]: return
                    _notes_shown_fired[0] = True
                    _notes_log("event shown")
                    if notes_use_custom:
                        wintitle.install(notes_window, emulate_snap=_USE_FRAMELESS)
                        if _USE_FRAMELESS:
                            threading.Thread(target=lambda: (time.sleep(0.06), wintitle.enforce_borderless_chrome(notes_window), wintitle.force_frame_refresh(notes_window)), daemon=True).start()
                        _notes_log("wintitle.install done")
                        threading.Thread(target=lambda: wintitle.set_webview_dark_background(notes_window, 5, 5, 5), daemon=True).start()
                        try:
                            wintitle.add_startup_script(notes_window, notes_prefill_js)
                        except Exception:
                            pass
                        # Removed early injection of notes_titlebar_js to prevent it showing during load
                        try:
                            wintitle.add_startup_script(notes_window, _EARLY_PAGE_ACCEL_JS)
                        except Exception:
                            pass
                        threading.Thread(
                            target=_titlebar_keepalive_loop,
                            args=(notes_window, notes_titlebar_js, 0.35, "nc-notes-titlebar"),
                            daemon=True,
                        ).start()
                    try:
                        wintitle.set_window_topmost(notes_window, bool(config.get("notes_window_pinned", self._notes_pinned)))
                    except Exception:
                        pass

                def _notes_on_loaded():
                    try:
                        href = str(notes_window.evaluate_js("location.href") or "")
                    except Exception:
                        href = ""
                    _notes_log(f"event loaded href={href}")
                    if notes_use_custom:
                        threading.Thread(
                            target=_inject_titlebar_with_retry,
                            args=(notes_window, notes_titlebar_js, 12, 0.2, "nc-notes-titlebar"),
                            daemon=True,
                        ).start()
                        threading.Thread(
                            target=lambda: (time.sleep(0.12), wintitle.sync_max_state(notes_window)),
                            daemon=True,
                        ).start()
                        if _USE_FRAMELESS:
                            threading.Thread(target=lambda: (time.sleep(0.26), wintitle.enforce_borderless_chrome(notes_window), wintitle.force_frame_refresh(notes_window)), daemon=True).start()
                        elif (_WINDOW_MODE == "custom") or (not _USE_FRAMELESS):
                            def _apply_notes_chrome_on_load():
                                _notes_log("Start _apply_notes_chrome_on_load loop")
                                for idx in range(80):
                                    ok = False
                                    try:
                                        ok = bool(notes_window.evaluate_js("(function(){return !!document.getElementById('nc-notes-titlebar');})();"))
                                    except Exception:
                                        pass
                                    if not ok and idx < 40:
                                        time.sleep(0.04)
                                        continue
                                    try:
                                        if wintitle.enable_custom_chrome(notes_window):
                                            _notes_log(f"enable_custom_chrome succeeded at idx={idx}")
                                            wintitle.force_frame_refresh(notes_window)
                                            if idx < 6:
                                                time.sleep(0.04)
                                                wintitle.force_frame_refresh(notes_window)
                                            break
                                    except Exception as e:
                                        _notes_log(f"enable_custom_chrome failed at idx={idx} error={e}")
                                    time.sleep(0.03)
                                _notes_log("End _apply_notes_chrome_on_load loop")
                                time.sleep(0.2)
                                try:
                                    wintitle.ensure_resizable_frame(notes_window)
                                    wintitle.force_frame_refresh(notes_window)
                                    _notes_log("ensure_resizable_frame called")
                                except Exception as e:
                                    _notes_log(f"ensure_resizable_frame error={e}")
                            threading.Thread(target=_apply_notes_chrome_on_load, daemon=True).start()

                def _notes_on_closed():
                    _notes_log("event closed")
                    with self._notes_window_lock:
                        if self._notes_window is notes_window:
                            self._notes_window = None

                notes_window.events.shown += _notes_on_shown
                notes_window.events.loaded += _notes_on_loaded
                notes_window.events.closed += _notes_on_closed
                _notes_log("notes window handlers bound")
                
                # In PyWebView, dynamically created windows might already be "shown" by the time
                # create_window returns, thus missing the shown event. We manually dispatch it.
                threading.Thread(target=_notes_on_shown, daemon=True).start()
                
                return {"success": True, "reused": False}
        except Exception as e:
            _notes_log(f"open failed error={e}\n{traceback.format_exc()}")
            return {"success": False, "message": str(e)}


def _acquire_bootstrap_slot() -> bool:
    global _BOOTSTRAP_IN_FLIGHT
    with _BOOTSTRAP_LOCK:
        if _BOOTSTRAP_IN_FLIGHT:
            return False
        _BOOTSTRAP_IN_FLIGHT = True
        return True


def _release_bootstrap_slot() -> None:
    global _BOOTSTRAP_IN_FLIGHT
    with _BOOTSTRAP_LOCK:
        _BOOTSTRAP_IN_FLIGHT = False


def _inject_titlebar_with_retry(
    win,
    titlebar_js: str,
    max_attempts: int = 40,
    delay_s: float = 0.25,
    marker_id: str = "nc-titlebar",
) -> None:
    """重试注入标题栏，覆盖慢加载/启动瞬间/页面跳转场景。"""
    for _ in range(max_attempts):
        try:
            marker = json.dumps(str(marker_id or "nc-titlebar"))
            ok = win.evaluate_js(
                f"(function(){{try{{{titlebar_js};return !!document.getElementById({marker});}}catch(e){{return false;}}}})();"
            )
            if str(ok).lower() in ("true", "1"):
                return
        except Exception:
            pass
        time.sleep(delay_s)


def _resolve_runtime_base_url() -> str:
    if str(config.get("local_proxy_enabled", True)).strip().lower() in {"1", "true", "on", "yes"}:
        return f"http://127.0.0.1:{LOCAL_PORT}"
    raw = str(config.get("nexora_url", DEFAULT_NEXORA_URL) or DEFAULT_NEXORA_URL).strip()
    if not raw:
        raw = DEFAULT_NEXORA_URL
    base = raw.rstrip("/")
    if base.endswith("/chat"):
        base = base[:-5]
    p = urlsplit(base)
    host = str(p.hostname or "").strip().lower()
    if host in {"localhost", "127.0.0.1"}:
        test_url = f"{base}/chat"
        try:
            resp = requests.get(test_url, timeout=2.2, allow_redirects=True)
            if int(resp.status_code or 0) >= 500:
                raise RuntimeError(f"status={resp.status_code}")
        except Exception:
            _set_pending_toast("本地地址不可达，已回退到线上地址")
            return DEFAULT_NEXORA_URL
    return base


def _build_entry_url(base_url: str, extra_query: dict | None = None) -> str:
    base = str(base_url or "").rstrip("/")
    if base.endswith("/chat"):
        chat_url = base
    else:
        chat_url = f"{base}/chat"
    parts = urlsplit(chat_url)
    query_pairs = [(str(k), str(v)) for k, v in parse_qsl(parts.query, keep_blank_values=True) if str(k) != "_nc_page_ts"]
    if isinstance(extra_query, dict):
        for k, v in extra_query.items():
            key = str(k or "").strip()
            if not key:
                continue
            if v is None:
                continue
            query_pairs.append((key, str(v)))
    # 仅对页面入口加 cache-buster，静态资源仍由 WebView2 缓存层按 ETag/缓存策略处理。
    query_pairs.append(("_nc_page_ts", str(int(time.time()))))
    final_query = urlencode(query_pairs, doseq=True)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, final_query, parts.fragment))


def _set_pending_toast(message: str) -> None:
    global _PENDING_TOAST_MESSAGE
    msg = str(message or "").strip()
    if not msg:
        return
    with _PENDING_TOAST_LOCK:
        _PENDING_TOAST_MESSAGE = msg


def _pop_pending_toast() -> str:
    global _PENDING_TOAST_MESSAGE
    with _PENDING_TOAST_LOCK:
        msg = _PENDING_TOAST_MESSAGE
        _PENDING_TOAST_MESSAGE = ""
    return msg


def _load_asset_manifest() -> dict:
    if not _ASSET_MANIFEST_PATH.exists():
        return {"assets": {}, "updated_at": 0}
    try:
        with open(_ASSET_MANIFEST_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"assets": {}, "updated_at": 0}
        assets = data.get("assets")
        if not isinstance(assets, dict):
            data["assets"] = {}
        return data
    except Exception:
        return {"assets": {}, "updated_at": 0}


def _save_asset_manifest(data: dict) -> None:
    payload = data if isinstance(data, dict) else {"assets": {}, "updated_at": 0}
    try:
        with open(_ASSET_MANIFEST_PATH, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _fetch_asset_meta(session: requests.Session, url: str) -> dict:
    u = str(url or "").strip()
    if not u:
        return {}
    headers = {"User-Agent": "NexoraCode/1.0"}
    try:
        resp = session.head(u, headers=headers, timeout=2.5, allow_redirects=True)
        if resp.status_code >= 400 or resp.status_code == 405:
            raise RuntimeError("head_not_usable")
    except Exception:
        resp = session.get(u, headers=headers, timeout=4, stream=True, allow_redirects=True)
        try:
            for _ in resp.iter_content(chunk_size=16384):
                break
        finally:
            resp.close()
    h = resp.headers or {}
    return {
        "etag": str(h.get("ETag") or "").strip(),
        "last_modified": str(h.get("Last-Modified") or "").strip(),
        "content_length": str(h.get("Content-Length") or "").strip(),
        "status_code": int(resp.status_code or 0),
        "checked_at": int(time.time()),
    }


def _check_asset_updates_async(win, host: str, page_url: str, asset_urls: list[str]) -> None:
    urls = []
    seen = set()
    for raw in (asset_urls or []):
        u = str(raw or "").strip()
        if not u:
            continue
        if u in seen:
            continue
        seen.add(u)
        urls.append(u)
    if not urls:
        return

    old_manifest = _load_asset_manifest()
    old_assets = old_manifest.get("assets") if isinstance(old_manifest.get("assets"), dict) else {}

    session = requests.Session()
    new_assets = {}
    added = 0
    changed = 0
    checked = 0

    for u in urls:
        checked += 1
        try:
            meta = _fetch_asset_meta(session, u)
        except Exception:
            continue
        if not meta:
            continue
        new_assets[u] = meta
        old = old_assets.get(u) if isinstance(old_assets, dict) else None
        if not isinstance(old, dict):
            added += 1
            continue
        key_old = (str(old.get("etag") or ""), str(old.get("last_modified") or ""), str(old.get("content_length") or ""))
        key_new = (str(meta.get("etag") or ""), str(meta.get("last_modified") or ""), str(meta.get("content_length") or ""))
        if key_old != key_new:
            changed += 1

    _save_asset_manifest({
        "updated_at": int(time.time()),
        "host": str(host or ""),
        "page_url": str(page_url or ""),
        "assets": new_assets,
    })

    had_old = isinstance(old_assets, dict) and len(old_assets) > 0
    msg = ""
    if not had_old and checked > 0:
        msg = f"NexoraCode 资源清单已建立（{checked} 项）"
    elif changed > 0 or added > 0:
        msg = f"检测到资源更新：新增 {added} 项，变更 {changed} 项"
    if msg:
        _set_pending_toast(msg)
        _show_toast_in_page(win, msg)


def _collect_asset_urls(win) -> list[str]:
    try:
        out = win.evaluate_js("""(function() {
  const list = [];
  const seen = new Set();
  const exts = ['.js','.css','.woff','.woff2','.ttf','.otf','.svg','.png','.jpg','.jpeg','.webp','.ico'];
  function pushUrl(raw) {
    if (!raw) return;
    let u = '';
    try { u = new URL(raw, location.href).href; } catch (_) { return; }
    if (!/^https?:\\/\\//i.test(u)) return;
    let path = '';
    let host = '';
    try {
      const uu = new URL(u);
      path = (uu.pathname || '').toLowerCase();
      host = (uu.hostname || '').toLowerCase();
    } catch (_) {
      return;
    }
    const staticLike = path.startsWith('/static/') || path === '/favicon.ico' || exts.some((e) => path.endsWith(e));
    if (host.includes('gstatic.com') || host.includes('googleapis.com')) return;
    const knownCdn = host.includes('cdn');
    if (!(staticLike || knownCdn)) return;
    if (seen.has(u)) return;
    seen.add(u);
    list.push(u);
  }
  document.querySelectorAll('link[href], script[src], img[src]').forEach((el) => {
    pushUrl(el.getAttribute('href') || el.getAttribute('src'));
  });
  return list;
})();""")
        if isinstance(out, list):
            return [str(x or "").strip() for x in out if str(x or "").strip()]
    except Exception:
        pass
    return []


def _show_toast_in_page(win, message: str) -> None:
    msg = str(message or "").strip()
    if not msg:
        return
    js_msg = json.dumps(msg, ensure_ascii=False)
    try:
        win.evaluate_js(f"""(function() {{
  const msg = {js_msg};
  if (typeof showToast === 'function') {{
    showToast(msg);
    return;
  }}
  let wrap = document.getElementById('nexoracode-toast-wrap');
  if (!wrap) {{
    wrap = document.createElement('div');
    wrap.id = 'nexoracode-toast-wrap';
    wrap.style.position = 'fixed';
    wrap.style.right = '16px';
    wrap.style.bottom = '16px';
    wrap.style.zIndex = '2147483646';
    document.body.appendChild(wrap);
  }}
  const item = document.createElement('div');
  item.textContent = msg;
  item.style.background = 'rgba(17,17,17,0.92)';
  item.style.color = '#fff';
  item.style.padding = '8px 12px';
  item.style.borderRadius = '8px';
  item.style.marginTop = '8px';
  item.style.fontSize = '12px';
  item.style.boxShadow = '0 6px 22px rgba(0,0,0,0.25)';
  wrap.appendChild(item);
  setTimeout(function() {{
    item.style.opacity = '0';
    item.style.transition = 'opacity .24s ease';
    setTimeout(function() {{ item.remove(); }}, 260);
  }}, 2400);
}})();""")
    except Exception:
        pass


def _titlebar_keepalive_loop(
    win,
    titlebar_js: str,
    interval_s: float = 2.0,
    marker_id: str = "nc-titlebar",
) -> None:
    """周期性自愈：防止慢网或页面切换后标题栏丢失。"""
    while not _STOP_POLL.is_set():
        _inject_titlebar_with_retry(win, titlebar_js, max_attempts=1, delay_s=0, marker_id=marker_id)
        try:
            wintitle.sync_max_state(win)
        except Exception:
            pass
        if _USE_FRAMELESS:
            try:
                wintitle.enforce_borderless_chrome(win)
            except Exception:
                pass
        time.sleep(interval_s)


def _install_native_titlebar_host(win) -> bool:
    # Legacy WinForms titlebar host path has been retired.
    # Kept as a no-op placeholder for compatibility with old references.
    return False


def _build_notes_titlebar_js() -> str:
    return r"""(function() {
  const ICON_PIN_ON   = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M14 3l7 7-3 1-3 6-2-2-6 3-1-1 3-6-2-2 6-3z"/></svg>';
  const ICON_PIN_OFF  = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3l7 7-3 1-3 6-2-2-6 3-1-1 3-6-2-2 6-3z"/></svg>';
  const ICON_MIN      = '<svg width="10" height="10" viewBox="0 0 10 1"><rect width="10" height="1" y="0" fill="currentColor"/></svg>';
  const ICON_MAX      = '<svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
  const ICON_RESTORE  = '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="0" width="8" height="8" fill="#050505" stroke="currentColor" stroke-width="1"/><rect x="0" y="2" width="8" height="8" fill="#050505" stroke="currentColor" stroke-width="1"/></svg>';
  const ICON_SETTINGS = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.8 1 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
    const ICON_CLOSE    = '<svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>';
  const TB_H = 36;
    let bridgeReady = !!(window.pywebview && window.pywebview.api);
    function canCallApi() {
        return bridgeReady && !!(window.pywebview && window.pywebview.api);
    }
    const api = () => canCallApi() ? window.pywebview.api : null;

  function ensureHead() {
    if (document.head) return true;
    if (!document.documentElement) return false;
    const h = document.createElement('head');
    document.documentElement.insertBefore(h, document.documentElement.firstChild);
    return true;
  }

  function ensureStyle() {
    if (!ensureHead()) return false;
    let s = document.getElementById('nc-notes-titlebar-style');
    if (!s) {
      s = document.createElement('style');
      s.id = 'nc-notes-titlebar-style';
      document.head.appendChild(s);
    }
    s.textContent = `
      :root { --nc-titlebar-h: ${TB_H}px; }
      #nc-notes-titlebar {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: var(--nc-titlebar-h);
        background: #050505;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        user-select: none;
        -webkit-user-select: none;
      }
      .nc-notes-btns {
        display: flex;
        align-items: center;
        gap: 0;
        padding-right: 6px;
      }
      .nc-notes-btn {
        width: 46px;
        height: var(--nc-titlebar-h);
        border: none;
        background: transparent;
        color: rgba(255,255,255,0.58);
        cursor: default;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background .12s, color .12s;
        padding: 0;
      }
      .nc-notes-btn:hover { background: rgba(255,255,255,0.10); color: #fff; }
      .nc-notes-btn.nc-close:hover { background: #e81123; color: #fff; }
            .nc-notes-rsz {
                position: fixed;
                z-index: 2147483647;
                pointer-events: auto;
                background: transparent;
            }
            .nc-notes-rsz.edge-top { top: 0; left: 10px; right: 10px; height: 8px; cursor: ns-resize; }
            .nc-notes-rsz.edge-bottom { bottom: 0; left: 10px; right: 10px; height: 8px; cursor: ns-resize; }
            .nc-notes-rsz.edge-left { left: 0; top: 10px; bottom: 10px; width: 8px; cursor: ew-resize; }
            .nc-notes-rsz.edge-right { right: 0; top: 10px; bottom: 10px; width: 8px; cursor: ew-resize; }
            .nc-notes-rsz.corner-tl { top: 0; left: 0; width: 12px; height: 12px; cursor: nwse-resize; }
            .nc-notes-rsz.corner-tr { top: 0; right: 0; width: 12px; height: 12px; cursor: nesw-resize; }
            .nc-notes-rsz.corner-bl { bottom: 0; left: 0; width: 12px; height: 12px; cursor: nesw-resize; }
            .nc-notes-rsz.corner-br { bottom: 0; right: 0; width: 12px; height: 12px; cursor: nwse-resize; }
            body.nc-notes-win-maximized .nc-notes-rsz { pointer-events: none !important; }
      body.notes-companion-mode .app-container {
        margin-top: var(--nc-titlebar-h) !important;
        height: calc(100vh - var(--nc-titlebar-h)) !important;
      }
      body.notes-companion-mode #notesPanel {
        top: var(--nc-titlebar-h) !important;
        height: calc(100vh - var(--nc-titlebar-h)) !important;
        max-height: calc(100vh - var(--nc-titlebar-h)) !important;
      }
    `;
    return true;
  }

  function setMaxIcon(isMax) {
    const btn = document.getElementById('nc-notes-max-btn');
    if (!btn) return;
    btn.innerHTML = isMax ? ICON_RESTORE : ICON_MAX;
    btn.title = isMax ? '\u8fd8\u539f' : '\u6700\u5927\u5316';
        if (document.body) {
            document.body.classList.toggle('nc-notes-win-maximized', !!isMax);
        }
  }
  window._ncTitlebarSetMaximized = setMaxIcon;

  function setPinIcon(pinned) {
    const btn = document.getElementById('nc-notes-pin-btn');
    if (!btn) return;
    btn.innerHTML = pinned ? ICON_PIN_ON : ICON_PIN_OFF;
    btn.title = pinned ? '\u53d6\u6d88\u7f6e\u9876' : '\u7f6e\u9876';
    btn.dataset.pinned = pinned ? '1' : '0';
  }

  function syncState() {
    try {
      const a = api();
      if (!a) return;
      if (a.sync_notes_window_state) a.sync_notes_window_state();
      if (a.is_notes_window_maximized) {
        a.is_notes_window_maximized().then(function(d) {
          setMaxIcon(!!(d && d.maximized));
        }).catch(function() {});
      }
      if (a.is_notes_window_pinned) {
        a.is_notes_window_pinned().then(function(d) {
          setPinIcon(!!(d && d.pinned));
        }).catch(function() {});
      }
      if (a.set_notes_window_bounds) {
        const w = Number(window.outerWidth || window.innerWidth || 0);
        const h = Number(window.outerHeight || window.innerHeight || 0);
        a.set_notes_window_bounds(w, h);
      }
    } catch (_) {}
  }

  function bindBar(bar) {
    if (!bar || bar.dataset.ncBound === '1') return;
    bar.dataset.ncBound = '1';
    let downState = null;
        let lastDownTs = 0;
        let lastDownX = 0;
        let lastDownY = 0;
        let skipNativeDbl = false;
    const clearDownState = () => { downState = null; };
    const pinBtn = bar.querySelector('.nc-pin');
      const minBtn = bar.querySelector('.nc-min');
    const maxBtn = bar.querySelector('.nc-max');
    const closeBtn = bar.querySelector('.nc-close');
    if (pinBtn) pinBtn.onclick = function(e) {
      e.stopPropagation();
      const a = api();
      if (!a || !a.toggle_notes_pin) return;
      a.toggle_notes_pin().then(function(d) {
        setPinIcon(!!(d && d.pinned));
      }).catch(function() {});
    };
      if (minBtn) minBtn.onclick = e => { e.stopPropagation(); api() && api().minimize_notes_window && api().minimize_notes_window(); };
    if (maxBtn) maxBtn.onclick = e => { e.stopPropagation(); api() && api().maximize_notes_window && api().maximize_notes_window(); };
    if (closeBtn) closeBtn.onclick = e => { e.stopPropagation(); api() && api().close_notes_window && api().close_notes_window(); };

    bar.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('.nc-notes-btns')) return;
      downState = { x: e.clientX, y: e.clientY, started: false };
      const onMove = function(ev) {
        if (!downState || downState.started) return;
        const dx = Math.abs((ev.clientX || 0) - downState.x);
        const dy = Math.abs((ev.clientY || 0) - downState.y);
        if (dx + dy < 4) return;
        downState.started = true;
        ev.preventDefault();
        api() && api().start_notes_window_drag && api().start_notes_window_drag();
      };
      const onUp = function() {
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
        clearDownState();
      };
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
    });
    bar.addEventListener('mouseup', clearDownState);
    bar.addEventListener('mouseleave', clearDownState);
    bar.addEventListener('dblclick', function(e) {
      if (e.target && e.target.closest && e.target.closest('.nc-notes-btns')) return;
      clearDownState();
      e.preventDefault();
      api() && api().maximize_notes_window && api().maximize_notes_window();
    });
  }

  function ensureBar() {
    if (!document.body) return false;
    let bar = document.getElementById('nc-notes-titlebar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'nc-notes-titlebar';
      bar.innerHTML = `
        <div class="nc-notes-btns">
          <button class="nc-notes-btn nc-pin" id="nc-notes-pin-btn" title="\u7f6e\u9876">${ICON_PIN_OFF}</button>
            <button class="nc-notes-btn nc-min" title="\u6700\u5c0f\u5316">${ICON_MIN}</button>
          <button class="nc-notes-btn nc-max" title="\u6700\u5927\u5316" id="nc-notes-max-btn">${ICON_MAX}</button>
          <button class="nc-notes-btn nc-close" title="\u5173\u95ed">${ICON_CLOSE}</button>
        </div>
      `;
      document.body.prepend(bar);
    }
    bindBar(bar);
    return true;
  }

    function ensureResizeGrips() {
        if (!document.body) return false;
        let wrap = document.getElementById('nc-notes-resize-grips');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'nc-notes-resize-grips';
            wrap.innerHTML = `
                <div class="nc-notes-rsz edge-top" data-edge="top"></div>
                <div class="nc-notes-rsz edge-bottom" data-edge="bottom"></div>
                <div class="nc-notes-rsz edge-left" data-edge="left"></div>
                <div class="nc-notes-rsz edge-right" data-edge="right"></div>
                <div class="nc-notes-rsz corner-tl" data-edge="top-left"></div>
                <div class="nc-notes-rsz corner-tr" data-edge="top-right"></div>
                <div class="nc-notes-rsz corner-bl" data-edge="bottom-left"></div>
                <div class="nc-notes-rsz corner-br" data-edge="bottom-right"></div>
            `;
            document.body.appendChild(wrap);
        }
        if (wrap.dataset.ncBound !== '1') {
            wrap.dataset.ncBound = '1';
            wrap.querySelectorAll('[data-edge]').forEach(function(el) {
                el.addEventListener('mousedown', function(e) {
                    if (e.button !== 0) return;
                    if (document.body && document.body.classList.contains('nc-notes-win-maximized')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const edge = String(el.dataset.edge || '').trim();
                    const a = api();
                    if (a && a.start_notes_window_resize) a.start_notes_window_resize(edge);
                });
            });
        }
        return true;
    }

  function ensureAll() {
        const ok = ensureStyle() && ensureBar() && ensureResizeGrips();
    if (ok) syncState();
    return ok;
  }

  let resizeTimer = null;
  window.addEventListener('resize', function() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      resizeTimer = null;
      syncState();
    }, 160);
  });

  if (!ensureAll()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { ensureAll(); }, { once: true });
    } else {
      setTimeout(function() { ensureAll(); }, 80);
    }
  }

    window.addEventListener('pywebviewready', function() {
        bridgeReady = true;
        try { syncState(); } catch (_) {}
    });

    if (!bridgeReady) {
        let checks = 0;
        const t = setInterval(function() {
            checks += 1;
            if (window.pywebview && window.pywebview.api) {
                bridgeReady = true;
                clearInterval(t);
                try { syncState(); } catch (_) {}
                return;
            }
            if (checks >= 80) {
                clearInterval(t);
            }
        }, 50);
    }
})();"""


def _build_notes_local_shell_html() -> str:
        return """<!doctype html>
<html lang=\"zh-CN\">
<head>
<meta charset=\"utf-8\"/>
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/>
<title>Nexora Notes</title>
<link rel=\"stylesheet\" href=\"https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css\"/>
<link rel=\"stylesheet\" href=\"/static/css/style.css\"/>
<link rel=\"stylesheet\" href=\"/static/css/easymde_override.css\"/>
<style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050505;color:#ddd;font-family:'Segoe UI','Microsoft YaHei',sans-serif;}
    #notes-shell{position:fixed;top:36px;left:0;right:0;bottom:0;overflow:hidden;padding:0;box-sizing:border-box;background:#fff;}
    #notes-shell #notesPanel, #notes-shell .notes-panel{
        position: relative !important;
        top: auto !important;
        right: auto !important;
        bottom: auto !important;
        left: auto !important;
        width: 100% !important;
        max-width: none !important;
        height: 100% !important;
        max-height: none !important;
        min-height: 0 !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        display: flex !important;
        z-index: 1 !important;
    }
    #notes-shell #notesPanel .notes-panel-head,
    #notes-shell .notes-panel .notes-panel-head{display:none !important;}
    #notes-shell #notesPanel .notes-panel-popout,
    #notes-shell #notesPanel #notesResizeHandle,
    #notes-shell .notes-panel .notes-panel-popout,
    #notes-shell .notes-panel #notesResizeHandle{display:none !important;}
    #notes-shell #notesPanel .notes-list, #notes-shell .notes-panel .notes-list{padding:10px !important;}
    #notes-state{position:fixed;left:10px;right:10px;bottom:8px;color:rgba(255,255,255,.52);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #notes-empty{position:fixed;inset:36px 0 0 0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.5);font-size:13px;}
</style>
</head>
<body>
<div id=\"notes-empty\">正在同步笔记...</div>
<div id=\"notes-shell\"></div>
<div id=\"notes-state\">初始化中...</div>
<script>
(function(){
    let lastHtml = '';
    let syncing = false;
    let bridgeChecks = 0;
    let missCount = 0;
    let hadSuccess = false;
    let lastState = '';
    let notesIndex = {};
    const shell = document.getElementById('notes-shell');
    const empty = document.getElementById('notes-empty');
    const state = document.getElementById('notes-state');
    try {
        if (document.body && !document.body.classList.contains('notes-companion-mode')) {
            document.body.classList.add('notes-companion-mode');
        }
    } catch (_) {}

    function hydrateFallbackIcons(root) {
        const host = root || document;
        if (!host || !host.querySelectorAll) return;
        const icons = {
            'fa-plus': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
            'fa-eraser': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 20H7"></path><path d="M14.5 4.5l5 5L9 20H4v-5z"></path></svg>',
            'fa-trash': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path></svg>',
            'fa-download': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"></path><path d="M7 10l5 5 5-5"></path><path d="M5 21h14"></path></svg>',
            'fa-xmark': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18"></path><path d="M6 6l12 12"></path></svg>'
        };
        host.querySelectorAll('i[class*="fa-"]').forEach((node) => {
            if (!node || node.dataset.ncSvgHydrated === '1') return;
            const classList = Array.from(node.classList || []);
            const key = classList.find((cls) => Object.prototype.hasOwnProperty.call(icons, cls));
            if (!key) return;
            node.dataset.ncSvgHydrated = '1';
            node.innerHTML = icons[key];
            node.classList.add('nc-inline-svg-icon');
            node.style.display = 'inline-flex';
            node.style.alignItems = 'center';
            node.style.justifyContent = 'center';
            node.style.lineHeight = '1';
        });
    }

    function setState(txt){
        const t = String(txt||'');
        if (t === lastState) return;
        lastState = t;
        if (state) state.textContent = t;
    }

    document.addEventListener('click', async function(e) {
        const target = e && e.target;
        const sourceBtn = target && target.closest ? target.closest('[data-action="jump-note-source"]') : null;
        if (!sourceBtn) return;
        e.preventDefault();
        e.stopPropagation();
        const noteId = String((sourceBtn.dataset && sourceBtn.dataset.noteId) || '').trim();
        if (!noteId) {
            setState('跳转失败：缺少 noteId');
            return;
        }
        const payload = (notesIndex && typeof notesIndex === 'object') ? notesIndex[noteId] : null;
        if (!payload || typeof payload !== 'object') {
            setState('跳转失败：缺少来源定位信息');
            return;
        }
        try {
            const api = window.pywebview && window.pywebview.api;
            if (!api || !api.jump_note_source_external) {
                setState('跳转失败：pywebview 跳转桥未就绪');
                return;
            }
            const res = await api.jump_note_source_external(payload);
            if (!res || !res.success) {
                setState('跳转失败：' + String((res && res.message) || 'unknown'));
                return;
            }
            setState('已跳转到笔记来源');
        } catch (err) {
            setState('跳转失败：' + String(err || 'unknown'));
        }
    }, true);

    async function syncOnce(){
        if (syncing) return;
        syncing = true;
        try {
            const api = window.pywebview && window.pywebview.api;
            if (!api || !api.get_notes_snapshot) {
                bridgeChecks += 1;
                const hasPy = !!window.pywebview;
                const hasApi = !!(window.pywebview && window.pywebview.api);
                setState('等待 pywebview 桥接... py=' + (hasPy ? '1' : '0') + ' api=' + (hasApi ? '1' : '0') + ' retry=' + String(bridgeChecks));
                return;
            }
            if (bridgeChecks > 0) {
                setState('桥接已就绪，正在拉取笔记快照...');
            }
            const d = await api.get_notes_snapshot();
            if (!d || !d.success) {
                missCount += 1;
                if (!hadSuccess) {
                    if (missCount >= 3) {
                        setState('未检测到笔记面板，保持等待...');
                    } else {
                        setState('正在同步笔记...');
                    }
                } else {
                    setState('笔记源暂不可用，等待恢复...');
                }
                return;
            }
            missCount = 0;
            hadSuccess = true;
            const html = String(d.html || '');
            if (!html) {
                setState(hadSuccess ? '笔记内容为空' : '笔记面板为空');
                return;
            }
            const panelLike = /id\\s*=\\s*["']notesPanel["']|class\\s*=\\s*["'][^"']*notes-panel/i.test(html);
            if (!panelLike) {
                missCount += 1;
                const hint = (d && d.hint && typeof d.hint === 'object') ? d.hint : null;
                const hintText = hint ? (' hint=' + [hint.tagName || '', hint.id || '', hint.className || ''].filter(Boolean).join('#')) : '';
                setState('检测到非面板节点，等待真实笔记面板...' + hintText);
                return;
            }
            if (html !== lastHtml) {
                const wrap = document.createElement('div');
                wrap.innerHTML = html;
                const panelNode = wrap.querySelector('#notesPanel, .notes-panel');
                const rendered = panelNode ? String(panelNode.outerHTML || '') : html;
                lastHtml = rendered;
                shell.innerHTML = rendered;
                hydrateFallbackIcons(shell);
                try {
                    const panel = shell.querySelector('#notesPanel, .notes-panel');
                    if (panel) {
                        panel.style.display = 'flex';
                        panel.style.visibility = 'visible';
                        panel.style.opacity = '1';
                        panel.setAttribute('aria-hidden', 'false');
                        panel.classList.add('active');
                        panel.classList.remove('closed');
                        panel.classList.remove('collapsed');
                    }
                } catch (_) {}
            }
            notesIndex = (d && d.note_index && typeof d.note_index === 'object') ? d.note_index : {};
            if (empty) empty.style.display = 'none';
            const frame = String((d && d.frame) || '').trim();
            const count = Number((d && d.items_count) || -1);
            const countText = Number.isFinite(count) && count >= 0 ? (' items=' + String(count)) : '';
            setState('已同步：' + String(d.href || '') + (frame ? (' [' + frame + ']') : '') + countText);
        } catch (e) {
            setState('同步失败：' + String(e || 'unknown'));
        } finally {
            syncing = false;
        }
    }

    window.addEventListener('pywebviewready', function() {
        setState('收到 pywebviewready，准备同步笔记...');
        syncOnce();
    });

    syncOnce();
    setInterval(syncOnce, 900);
})();
</script>
</body>
</html>
"""


def _agent_tunnel_loop(registry: ToolRegistry, agent_token: str, base_url: str):
    """
    通过 WebSocket 持续与服务器保持长连接，作为远端 LLM 的本地 Tool 计算节点
    """
    import websocket
    parsed = urlsplit(base_url)
    ws_scheme = "wss" if parsed.scheme == "https" else "ws"
    ws_url = f"{ws_scheme}://{parsed.netloc}/ws/agent"

    while not _STOP_POLL.is_set():
        try:
            ws = websocket.WebSocket()
            ws.connect(ws_url, timeout=10)

            # 1. 认证
            ws.send(json.dumps({
                "type": "auth",
                "agent_token": agent_token
            }))
            auth_msg = ws.recv()
            if not auth_msg:
                raise Exception("Empty auth response")
            auth_resp = json.loads(auth_msg)
            if auth_resp.get("type") != "auth_ok":
                print(f"[NexoraCode WSS] Auth failed: {auth_resp}")
                ws.close()
                time.sleep(5)
                continue

            print("[NexoraCode WSS] Tunnel Connected and Authenticated!")

            # 2. 注册工具
            tools = registry.list_tools_llm_format()
            ws.send(json.dumps({
                "type": "sync_tools",
                "tools": tools
            }))

            # 3. 消息循环
            ws.settimeout(2.0)
            last_ping = time.time()

            while not _STOP_POLL.is_set():
                # 心跳保活
                if time.time() - last_ping > 15:
                    try:
                        ws.send(json.dumps({"type": "ping"}))
                    except Exception:
                        break # 连接断开，触发重连
                    last_ping = time.time()

                try:
                    msg = ws.recv()
                    if not msg:
                        continue
                        
                    payload = json.loads(msg)
                    ctype = payload.get("type")
                    
                    if ctype == "pong":
                        pass
                    elif ctype == "call_tool":
                        task_id = payload.get("task_id")
                        tool_name = payload.get("tool_name")
                        args = payload.get("args", {})

                        print(f"[NexoraCode WSS] Executing tool {tool_name} (task={task_id})")
                        try:
                            result = registry.execute(tool_name, args)
                        except Exception as e:
                            print(f"[NexoraCode WSS] Tool Execution Exception: {e}")
                            result = {"error": str(e), "success": False}

                        # 回传结果
                        ws.send(json.dumps({
                            "type": "tool_result",
                            "task_id": task_id,
                            "result": result
                        }))

                except websocket.WebSocketTimeoutException:
                    pass
                except json.JSONDecodeError:
                    pass
                except websocket.WebSocketConnectionClosedException:
                    print("[NexoraCode WSS] Connection closed by server")
                    break
                except Exception as loop_e:
                    print(f"[NexoraCode WSS] Loop Error: {loop_e}")
                    break

            ws.close()

        except Exception as e:
            print(f"[NexoraCode WSS] Disconnected or error: {e}")
            time.sleep(3)


def main():
    registry = ToolRegistry()
    js_api = NexoraWindowApi()
    print(f"[NexoraWindow] mode={_WINDOW_MODE} frameless={_USE_FRAMELESS} custom_titlebar={_USE_CUSTOM_TITLEBAR}")
    runtime_base_url = _resolve_runtime_base_url()
    print(f"[NexoraProxy] runtime_base_url={runtime_base_url}")
    runtime_host = str(urlsplit(runtime_base_url).hostname or "chat.himpqblog.cn").strip().lower()
    _allow_iframe_3p_cookie = str(config.get("allow_iframe_third_party_cookies", True)).strip().lower() in {"1", "true", "on", "yes"}
    _unsafe_disable_web_security = str(config.get("unsafe_disable_web_security", True)).strip().lower() in {"1", "true", "on", "yes"}
    _relax_iframe_samesite = str(config.get("relax_iframe_samesite", True)).strip().lower() in {"1", "true", "on", "yes"}
    _auto_escape_iframe_login_loop = str(config.get("auto_escape_iframe_login_loop", False)).strip().lower() in {"1", "true", "on", "yes"}
    _disable_features = []
    if _PERSISTENT_OUTER_SHELL and _allow_iframe_3p_cookie:
        _disable_features.extend(["BlockThirdPartyCookies", "ThirdPartyStoragePartitioning"])
        print("[NexoraShell] third-party cookie compatibility enabled for iframe login")
    if _PERSISTENT_OUTER_SHELL and _relax_iframe_samesite:
        _disable_features.extend(["SameSiteByDefaultCookies", "CookiesWithoutSameSiteMustBeSecure"])
        _append_webview2_arg("--disable-site-isolation-trials")
        print("[NexoraShell] SameSite relaxation enabled for iframe login")
    if _PERSISTENT_OUTER_SHELL and _unsafe_disable_web_security:
        _append_webview2_arg("--disable-web-security")
        _disable_features.extend(["IsolateOrigins", "site-per-process"])
        print("[NexoraShell] unsafe web security disabled for iframe compatibility")
    if _disable_features:
        _append_webview2_arg("--disable-features=" + ",".join(_disable_features))

    devtools_enabled = str(config.get("devtools_enabled", False)).strip().lower() in {"1", "true", "on", "yes"}
    devtools_auto_open = str(config.get("devtools_auto_open", True)).strip().lower() in {"1", "true", "on", "yes"}
    try:
        devtools_port = int(config.get("devtools_port", 9222) or 9222)
    except Exception:
        devtools_port = 9222

    if devtools_enabled:
        args = [f"--remote-debugging-port={devtools_port}"]
        if devtools_auto_open:
            args.append("--auto-open-devtools-for-tabs")
        for a in args:
            _append_webview2_arg(a)
        print(f"[NexoraDevTools] enabled args={os.environ.get('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS','')}")
        print(f"[NexoraDevTools] inspect target: http://127.0.0.1:{devtools_port}")

    # 启动本地服务（健康检查用，工具执行改为主动 poll）
    server_thread = threading.Thread(target=start_local_server, daemon=True)
    server_thread.start()

    # 系统托盘
    tray_thread = threading.Thread(target=run_tray, daemon=True)
    tray_thread.start()

    agent_token = config.get("agent_token")
    auth_trace = str(config.get("auth_trace", True)).strip().lower() in {"1", "true", "on", "yes"}
    print(f"[NexoraAuthTrace] auth_trace_enabled={auth_trace}")
    global _EARLY_PAGE_ACCEL_JS
    if "__NC_AGENT_TOKEN__" in _EARLY_PAGE_ACCEL_JS:
        _EARLY_PAGE_ACCEL_JS = _EARLY_PAGE_ACCEL_JS.replace("__NC_AGENT_TOKEN__", json.dumps(str(agent_token or ""), ensure_ascii=False))
    if "__NC_AUTH_TRACE__" in _EARLY_PAGE_ACCEL_JS:
        _EARLY_PAGE_ACCEL_JS = _EARLY_PAGE_ACCEL_JS.replace("__NC_AUTH_TRACE__", "true" if auth_trace else "false")
    if "__NC_AUTH_TRACE_HEARTBEAT__" in _EARLY_PAGE_ACCEL_JS:
        _EARLY_PAGE_ACCEL_JS = _EARLY_PAGE_ACCEL_JS.replace("__NC_AUTH_TRACE_HEARTBEAT__", "true" if _AUTH_TRACE_HEARTBEAT else "false")
    tools = registry.list_tools_llm_format()
    entry_url = _build_entry_url(runtime_base_url)

    # 创建 WebView 窗口
    # window_mode:
    # - native: 原生标题栏 + 原生边框
    # - frameless: 全自绘（无原生边框）
    # - custom: 自绘标题栏 + 原生边框（推荐给需要 Windows 贴边动画的场景）
    window_kwargs = {
        "title": "NexoraCode",
        "url": entry_url,
        "width": config.get("window_width", 960),
        "height": config.get("window_height", 700),
        "min_size": (900, 560),
        "resizable": True,
        "frameless": _USE_FRAMELESS,
        "text_select": True,
        "js_api": js_api,
    }
    if _USE_BOOTSTRAP_SHELL:
        _bootstrap_entry = _build_entry_url(runtime_base_url, {"nc_iframe_content": "1"} if _PERSISTENT_OUTER_SHELL else None)
        _bootstrap_html = _BOOTSTRAP_HTML_MODE.replace("__NC_ENTRY_URL__", json.dumps(_bootstrap_entry, ensure_ascii=False))
        _bootstrap_html = _bootstrap_html.replace("__NC_AUTO_ESCAPE_IFRAME_LOGIN_LOOP__", "true" if _auto_escape_iframe_login_loop else "false")
        _bootstrap_html = _bootstrap_html.replace("__NC_AUTH_TRACE_HEARTBEAT__", "true" if _AUTH_TRACE_HEARTBEAT else "false")
        if _PERSISTENT_OUTER_SHELL:
            set_shell_html(_bootstrap_html)
            window_kwargs["url"] = f"http://127.0.0.1:{LOCAL_PORT}/nc/shell"
            window_kwargs.pop("html", None)
        else:
            window_kwargs["html"] = _bootstrap_html
            window_kwargs.pop("url", None)
        window_kwargs["easy_drag"] = False
        window_kwargs["background_color"] = "#050505"
    try:
        win = webview.create_window(**window_kwargs)
    except TypeError as e:
        print(f"[NexoraCode] create_window frameless not supported, fallback keep js_api: {e}")
        fallback_kwargs = dict(window_kwargs)
        fallback_kwargs.pop("frameless", None)
        try:
            win = webview.create_window(**fallback_kwargs)
        except TypeError as e2:
            print(f"[NexoraCode] create_window js_api not supported, fallback plain window: {e2}")
            fallback_kwargs.pop("js_api", None)
            win = webview.create_window(**fallback_kwargs)
    js_api.bind(win, runtime_base_url)

    _message_cfg = config.get("message") or {}
    _msg_bootstrap = str(_message_cfg.get("bootstrap") or "加载中").strip() or "加载中"
    _msg_login = str(_message_cfg.get("login") or "正在登陆").strip() or "正在登陆"
    _iframe_shell_enabled = str(config.get("iframe_shell_enabled", False)).strip().lower() in {"1", "true", "on", "yes"}

    _TITLEBAR_JS = r"""(function() {
    if (document.getElementById('nc-boot-bar')) {
        return;
    }
    if (window.__ncTitlebarScriptActive && document.getElementById('nc-titlebar') && document.getElementById('nc-app-frame')) {
        return;
    }
    window.__ncTitlebarScriptActive = true;
        if (window.top !== window.self) {
            return;
        }
    const WINDOW_MODE = "__NC_WINDOW_MODE__";
        const FRAME_PARAM = 'nc_iframe_content';
        const NAV_TEXT_BOOTSTRAP = __NC_MSG_BOOTSTRAP__;
        const NAV_TEXT_LOGIN = __NC_MSG_LOGIN__;
        const IFRAME_SHELL_ENABLED = __NC_IFRAME_SHELL_ENABLED__;
    const IS_CUSTOM_MODE = WINDOW_MODE === 'custom';
    const EDGE_CURSOR = {
        'top': 'ns-resize',
        'bottom': 'ns-resize',
        'left': 'ew-resize',
        'right': 'ew-resize',
        'top-left': 'nwse-resize',
        'top-right': 'nesw-resize',
        'bottom-left': 'nesw-resize',
        'bottom-right': 'nwse-resize'
    };
  const ICON_MIN     = '<svg width="10" height="10" viewBox="0 0 10 1"><rect width="10" height="1" y="0" fill="currentColor"/></svg>';
  const ICON_MAX     = '<svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
    const ICON_RESTORE = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 1.5h5.5v5.5H3zM1.5 3h5.5v5.5H1.5z" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
  const ICON_SETTINGS = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.8 1 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
    const ICON_CLOSE   = '<svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>';

    const api = () => window.pywebview && window.pywebview.api;
    const TB_H = 36;
        let navProgress = 0;
        let navProgressTimer = null;
        let navLastHideAt = 0;
        let navTraceTimer = null;

  function ensureHead() {
    if (document.head) return true;
    if (!document.documentElement) return false;
    const h = document.createElement('head');
    document.documentElement.insertBefore(h, document.documentElement.firstChild);
    return true;
  }

  function ensureStyle() {
    if (!ensureHead()) return false;
    let s = document.getElementById('nc-titlebar-style');
    if (!s) {
      s = document.createElement('style');
      s.id = 'nc-titlebar-style';
      document.head.appendChild(s);
    }
    s.textContent = `
            html, body {
                margin: 0 !important;
                height: 100% !important;
                overflow: hidden !important;
            }
      :root { --nc-titlebar-h: ${TB_H}px; }
      ::selection { background: #5b3a21; color: #ffe7bf; }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.18); border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.32); }
      #nc-titlebar {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: var(--nc-titlebar-h);
        background: #050505;
        z-index: 2147483647;
                box-sizing: border-box;
                overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: flex-end;
                border-bottom: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-app-region: drag;
      }
      .nc-tb-btns {
        display: flex;
        align-items: center;
        gap: 0;
                padding-right: 0;
                height: 100%;
                box-sizing: border-box;
        -webkit-app-region: no-drag;
      }
      .nc-tb-btn {
        width: 46px;
                height: 100%;
        border: none;
        background: transparent;
        color: rgba(255,255,255,0.55);
        cursor: default;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background .12s, color .12s;
        padding: 0;
                margin: 0;
                box-sizing: border-box;
                line-height: 1;
        -webkit-app-region: no-drag;
      }
      .nc-tb-btn:hover { background: rgba(255,255,255,0.10); color: #fff; }
      .nc-tb-btn.nc-close:hover { background: #e81123; color: #fff; }
            .nc-tb-btn svg { pointer-events: none; display: block; }
      .nc-rsz {
        position: fixed;
                z-index: 2147483647;
        pointer-events: auto;
        -webkit-app-region: no-drag;
        background: transparent;
      }
            .nc-rsz.edge-top { top: 0; left: 10px; right: 10px; height: 8px; }
            .nc-rsz.edge-bottom { bottom: 0; left: 10px; right: 10px; height: 8px; }
            .nc-rsz.edge-left { left: 0; top: 10px; bottom: 10px; width: 8px; }
            .nc-rsz.edge-right { right: 0; top: 10px; bottom: 10px; width: 8px; }
            .nc-rsz.corner-tl { top: 0; left: 0; width: 12px; height: 12px; }
            .nc-rsz.corner-tr { top: 0; right: 0; width: 12px; height: 12px; }
            .nc-rsz.corner-bl { bottom: 0; left: 0; width: 12px; height: 12px; }
            .nc-rsz.corner-br { bottom: 0; right: 0; width: 12px; height: 12px; }
        html.nc-win-maximized .nc-rsz { pointer-events: none !important; }
            #nc-app-frame {
                position: fixed;
                top: var(--nc-titlebar-h);
                left: 0;
                right: 0;
                bottom: 0;
                overflow: hidden;
                isolation: isolate;
                z-index: 1;
                background: #050505;
            }
            #nc-app-iframe {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                border: none;
                outline: none;
                background: #050505;
                display: block;
            }
      .messages-area,
      .message,
      .message-content,
      .content-body,
      .thinking-content,
      #knowledgeViewer,
      .cm-editor,
      .cm-scroller,
      .note-text,
      .note-text * {
        user-select: text !important;
        -webkit-user-select: text !important;
      }
      html.nc-titlebar-ready #notesPanel {
        top: calc(var(--nc-titlebar-h) + 10px) !important;
        max-height: calc(100vh - var(--nc-titlebar-h) - 20px) !important;
      }
            @media (max-width: 900px) {
                html.nc-titlebar-ready [id*="sidebar" i],
                html.nc-titlebar-ready [class*="sidebar" i],
                html.nc-titlebar-ready [id*="panel" i],
                html.nc-titlebar-ready [class*="panel" i],
                html.nc-titlebar-ready [id*="drawer" i],
                html.nc-titlebar-ready [class*="drawer" i],
                html.nc-titlebar-ready [id*="knowledge" i],
                html.nc-titlebar-ready [class*="knowledge" i],
                html.nc-titlebar-ready [id*="file" i],
                html.nc-titlebar-ready [class*="file" i] {
                    top: var(--nc-titlebar-h) !important;
                    max-height: calc(100vh - var(--nc-titlebar-h)) !important;
                }
            }
      .mobile-header-menu-panel {
        z-index: 2147483500 !important;
      }
            #nc-nav-veil {
                position: fixed;
                top: var(--nc-titlebar-h);
                left: 0;
                right: 0;
                bottom: 0;
                background: #050505;
                z-index: 2147483646;
                display: none;
                align-items: center;
                justify-content: center;
                flex-direction: column;
                gap: 10px;
                color: rgba(255,255,255,0.8);
                font-size: 12px;
                letter-spacing: .2px;
                user-select: none;
                -webkit-user-select: none;
                pointer-events: auto;
            }
            #nc-nav-veil .nc-nav-boot-stage {
                position: relative;
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            #nc-nav-veil .nc-nav-brand {
                font-size: 84px;
                font-weight: 700;
                color: #ffffff;
                letter-spacing: -4px;
                display: flex;
                align-items: baseline;
                line-height: 1;
                text-shadow: 0 10px 30px rgba(0,0,0,0.5);
                animation: nc-nav-fade-in 1.2s ease-out;
            }
            #nc-nav-veil .nc-nav-sub {
                margin-top: 14px;
                color: rgba(255,255,255,0.66);
                font-size: 13px;
                letter-spacing: .4px;
                text-align: center;
                animation: nc-nav-fade-in 1.2s ease-out;
            }
            #nc-nav-veil .nc-nav-progress {
                margin-top: 12px;
                width: min(420px, 86vw);
                height: 6px;
                background: rgba(255,255,255,0.12);
                border-radius: 999px;
                overflow: hidden;
            }
            #nc-nav-veil .nc-nav-progress-bar {
                width: 0%;
                height: 100%;
                background: linear-gradient(90deg,#8ea8ff,#f5f8ff);
                transition: width .18s ease;
            }
            #nc-nav-veil .nc-nav-resource {
                margin-top: 8px;
                color: rgba(255,255,255,0.5);
                font-size: 12px;
                max-width: min(560px, 90vw);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                text-align: center;
            }
            #nc-nav-veil .nc-nav-brand .dot {
                color: #444;
                margin-left: 4px;
                display: inline-flex;
                min-width: 84px;
            }
            #nc-nav-veil .nc-nav-brand .dot::after {
                content: ".";
                animation: nc-nav-dots 4.5s infinite;
                display: inline-block;
            }
            #nc-nav-veil.nc-visible {
                display: flex;
            }
            @keyframes nc-nav-fade-in {
                from { opacity: 0; transform: translateY(20px); filter: blur(10px); }
                to { opacity: 1; transform: translateY(0); filter: blur(0); }
            }
            @keyframes nc-nav-dots {
                0%{content:".";opacity:1;}5%{content:".";opacity:0;}10%{content:".";opacity:1;}15%{content:".";opacity:0;}
                20%{content:".";opacity:1;}22%{content:".";opacity:1;}33%{content:"..";opacity:1;}44%{content:"...";opacity:1;}
                55%{content:"...?";opacity:1;}77%{content:"...?";opacity:1;}80%{content:"..";opacity:1;}85%{content:".";opacity:1;}
                90%{content:"";opacity:1;}100%{content:".";opacity:1;}
            }
            html.nc-desktop-mode #toggleSidebarMobile,
            html.nc-desktop-mode .mobile-header-menu {
                display: none !important;
            }
            html.nc-desktop-mode #settingsModal .settings-modal-custom {
        width: min(960px, calc(100vw - 64px)) !important;
        max-width: 960px !important;
        min-width: 760px !important;
        height: calc(100vh - var(--nc-titlebar-h) - 72px) !important;
        min-height: 520px !important;
        max-height: calc(100vh - var(--nc-titlebar-h) - 72px) !important;
        margin: 0 auto !important;
        box-sizing: border-box !important;
        display: flex !important;
        flex-direction: column !important;
        resize: both !important;
        overflow: hidden !important;
      }
            html.nc-desktop-mode #settingsModal.modal-backdrop {
        align-items: flex-start !important;
        justify-content: center !important;
                padding-top: calc(var(--nc-titlebar-h) + 16px) !important;
                padding-bottom: 16px !important;
        box-sizing: border-box !important;
      }
            html.nc-desktop-mode #settingsModal .modal-body {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
      }
            html.nc-desktop-mode #settingsModal .admin-shell {
        display: grid !important;
        grid-template-columns: 220px minmax(0, 1fr) !important;
        gap: 0 !important;
        height: 100% !important;
        min-height: 0 !important;
      }
            html.nc-desktop-mode #settingsModal .settings-nav,
            html.nc-desktop-mode #settingsModal .admin-nav {
        width: 220px !important;
        min-width: 220px !important;
        max-width: 220px !important;
        display: flex !important;
        flex-direction: column !important;
        height: 100% !important;
        min-height: 0 !important;
        overflow-y: auto !important;
      }
            html.nc-desktop-mode #settingsModal .settings-content,
            html.nc-desktop-mode #settingsModal .admin-content {
        min-width: 0 !important;
        height: 100% !important;
        min-height: 0 !important;
        overflow: auto !important;
      }
            html.nc-desktop-mode #settingsModal .admin-users-layout {
        display: grid !important;
        grid-template-columns: 280px minmax(0, 1fr) !important;
      }
            html.nc-desktop-mode .modal-backdrop .modal {
        max-height: calc(100vh - 56px) !important;
        overflow: hidden !important;
      }
    `;
    return true;
  }

    function syncViewportMode() {
        if (!document.documentElement) return;
        const desktop = window.innerWidth >= 980;
        document.documentElement.classList.toggle('nc-desktop-mode', desktop);
        document.documentElement.classList.toggle('nc-mobile-mode', !desktop);
  }

  function setMaxIcon(isMax) {
    const btn = document.getElementById('nc-max-btn');
    if (!btn) return;
    btn.innerHTML = isMax ? ICON_RESTORE : ICON_MAX;
    btn.title = isMax ? '\u8fd8\u539f' : '\u6700\u5927\u5316';
        if (document.documentElement) {
            document.documentElement.classList.toggle('nc-win-maximized', !!isMax);
        }
        window.__ncWinMaximized = !!isMax;
        applyResizeGripState();
  }
  window._ncTitlebarSetMaximized = setMaxIcon;

  function bindBar(bar) {
    if (!bar || bar.dataset.ncBound === '1') return;
    bar.dataset.ncBound = '1';
    let downState = null;
        let lastDownTs = 0;
        let lastDownX = 0;
        let lastDownY = 0;
        let skipNativeDbl = false;
    const clearDownState = () => { downState = null; };

    const settingsBtn = bar.querySelector('.nc-settings');
      const minBtn = bar.querySelector('.nc-min');
    const maxBtn = bar.querySelector('.nc-max');
    const closeBtn = bar.querySelector('.nc-close');
    if (settingsBtn) settingsBtn.onclick = e => { e.stopPropagation(); api() && api().open_settings && api().open_settings(); };
      if (minBtn) minBtn.onclick = e => { e.stopPropagation(); api() && api().minimize_window && api().minimize_window(); };
    if (maxBtn) maxBtn.onclick = e => { e.stopPropagation(); api() && api().maximize_window && api().maximize_window(); };
    if (closeBtn) closeBtn.onclick = e => { e.stopPropagation(); api() && api().close_window && api().close_window(); };

    bar.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('.nc-tb-btns')) return;
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const near = Math.abs((e.clientX || 0) - lastDownX) + Math.abs((e.clientY || 0) - lastDownY) <= 8;
            const isDouble = (now - lastDownTs) <= 300 && near;
            lastDownTs = now;
            lastDownX = (e.clientX || 0);
            lastDownY = (e.clientY || 0);
            if (isDouble) {
                skipNativeDbl = true;
                clearDownState();
                e.preventDefault();
                const a = api();
                if (a && a.maximize_window) {
                    a.maximize_window();
                }
                return;
            }
      downState = { x: e.clientX, y: e.clientY, started: false };
      const onMove = function(ev) {
        if (!downState || downState.started) return;
        const dx = Math.abs((ev.clientX || 0) - downState.x);
        const dy = Math.abs((ev.clientY || 0) - downState.y);
        if (dx + dy < 4) return;
        downState.started = true;
        ev.preventDefault();
        api() && api().start_window_drag && api().start_window_drag();
      };
      const onUp = function() {
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
        clearDownState();
      };
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
    });

    bar.addEventListener('mouseup', clearDownState);
    bar.addEventListener('mouseleave', clearDownState);

        bar.addEventListener('dblclick', function(e) {
            if (e.target && e.target.closest && e.target.closest('.nc-tb-btns')) return;
            if (skipNativeDbl) {
                skipNativeDbl = false;
                e.preventDefault();
                return;
            }
            clearDownState();
            e.preventDefault();
            const a = api();
            if (a && a.maximize_window) {
                a.maximize_window();
            }
        });

  }

  function ensureBar() {
    if (!document.body) return false;
    let bar = document.getElementById('nc-titlebar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'nc-titlebar';
      bar.innerHTML = `
        <div class="nc-tb-btns">
          <button class="nc-tb-btn nc-settings" title="\u8bbe\u7f6e">${ICON_SETTINGS}</button>
            <button class="nc-tb-btn nc-min" title="\u6700\u5c0f\u5316">${ICON_MIN}</button>
          <button class="nc-tb-btn nc-max" title="\u6700\u5927\u5316" id="nc-max-btn">${ICON_MAX}</button>
          <button class="nc-tb-btn nc-close" title="\u5173\u95ed">${ICON_CLOSE}</button>
        </div>
      `;
      document.body.prepend(bar);
    }
    if (document.documentElement) {
      document.documentElement.classList.add('nc-titlebar-ready');
    }
    bindBar(bar);
    return true;
  }

  function ensureResizeGrips() {
    if (!document.body) return false;
    let wrap = document.getElementById('nc-resize-grips');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'nc-resize-grips';
      wrap.innerHTML = `
        <div class="nc-rsz edge-top" data-edge="top"></div>
        <div class="nc-rsz edge-bottom" data-edge="bottom"></div>
        <div class="nc-rsz edge-left" data-edge="left"></div>
        <div class="nc-rsz edge-right" data-edge="right"></div>
        <div class="nc-rsz corner-tl" data-edge="top-left"></div>
        <div class="nc-rsz corner-tr" data-edge="top-right"></div>
        <div class="nc-rsz corner-bl" data-edge="bottom-left"></div>
        <div class="nc-rsz corner-br" data-edge="bottom-right"></div>
      `;
      document.body.appendChild(wrap);
    }
    if (wrap.dataset.ncBound !== '1') {
      wrap.dataset.ncBound = '1';
      wrap.querySelectorAll('[data-edge]').forEach(function(el) {
        el.addEventListener('mousedown', function(e) {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          const edge = String(el.dataset.edge || '').trim();
          const a = api();
                    if (!a || !a.start_window_resize) return;
                    if (window.__ncWinMaximized) return;
                    a.start_window_resize(edge);
        });
      });
    }
        applyResizeGripState();
    return true;
  }

    function ensureIframeShell() {
        if (!IFRAME_SHELL_ENABLED) {
            return true;
        }
        if (!document.body) return false;
        let frame = document.getElementById('nc-app-frame');
        if (!frame) {
            frame = document.createElement('div');
            frame.id = 'nc-app-frame';
            frame.innerHTML = '<iframe id="nc-app-iframe" referrerpolicy="strict-origin-when-cross-origin" allow="clipboard-read; clipboard-write"></iframe>';
            document.body.appendChild(frame);
        }
        const iframe = document.getElementById('nc-app-iframe');
        if (!iframe) return false;

        let currentHref = '';
        try {
            currentHref = String(window.location.href || '');
        } catch (_) {
            currentHref = '';
        }
        if (!currentHref) return false;

        let targetHref = currentHref;
        try {
            const u = new URL(currentHref);
            if (u.searchParams.get(FRAME_PARAM) !== '1') {
                u.searchParams.set(FRAME_PARAM, '1');
            }
            targetHref = u.toString();
        } catch (_) {}

        const prevSrc = String(iframe.getAttribute('src') || '');
        if (!prevSrc) {
            iframe.setAttribute('src', targetHref);
            try { console.log('[NexoraShell] iframe init src=' + targetHref); } catch (_) {}
        } else if (prevSrc !== targetHref) {
            try { console.log('[NexoraShell] keep existing iframe src, skip reset prev=' + prevSrc + ' next=' + targetHref); } catch (_) {}
        }

        if (iframe.dataset.ncBound !== '1') {
            iframe.dataset.ncBound = '1';

            const bindIframeDocEvents = function() {
                try {
                    const cw = iframe.contentWindow;
                    const cd = iframe.contentDocument;
                    if (!cw || !cd) return;

                    try {
                        const a = api();
                        if (a && a.log_auth_trace) {
                            a.log_auth_trace('[NexoraAuth] titlebar bindIframeDocEvents success');
                        }
                    } catch (_) {}

                    try {
                        if (!cw.pywebview && window.pywebview) {
                            cw.pywebview = window.pywebview;
                        }
                    } catch (_) {}

                    // Avoid long render stalls on restricted networks.
                    try {
                        const links = cd.querySelectorAll('link[rel="stylesheet"][href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]');
                        links.forEach(function(l) {
                            try { l.remove(); } catch (_) {}
                        });
                    } catch (_) {}

                    if (cd.documentElement && cd.documentElement.dataset.ncNavHooked === '1') {
                        return;
                    }
                    if (cd.documentElement) {
                        cd.documentElement.dataset.ncNavHooked = '1';
                    }

                    // Avoid aggressive veil toggling for iframe beforeunload;
                    // it causes black flicker on SPA/internal transitions.

                    const hideSoftNav = function() {
                        hideNavVeil('iframe-soft-nav');
                    };

                    cw.addEventListener('hashchange', hideSoftNav, true);
                    cw.addEventListener('popstate', hideSoftNav, true);

                    try {
                        const hp = cw.history;
                        if (hp && !hp.__ncPatched) {
                            hp.__ncPatched = true;
                            const rawPush = hp.pushState;
                            const rawReplace = hp.replaceState;
                            hp.pushState = function() {
                                const ret = rawPush.apply(this, arguments);
                                hideSoftNav();
                                return ret;
                            };
                            hp.replaceState = function() {
                                const ret = rawReplace.apply(this, arguments);
                                hideSoftNav();
                                return ret;
                            };
                        }
                    } catch (_) {}
                } catch (_) {}
                try {
                    const a = api();
                    if (a && a.log_auth_trace) {
                        a.log_auth_trace('[NexoraAuth] titlebar bindIframeDocEvents failed (likely cross-origin)');
                    }
                } catch (_) {}
            };

            iframe.addEventListener('load', function() {
                bindIframeDocEvents();
                bindNavTrace(iframe);
                try {
                    const ihref = String((iframe.contentWindow && iframe.contentWindow.location && iframe.contentWindow.location.href) || '');
                    setNavResource('iframe-load | ' + (ihref || 'unknown'));
                } catch (_) {}
                hideNavVeil('iframe-load');
            });
        }

        bindNavTrace(iframe);

        // Do not destructively clean top-level body nodes.
        // Cleaning can leave a half-mutated DOM (comments-only artifacts)
        // when app scripts are still mounting during shell conversion.

        if (document.documentElement) {
            document.documentElement.classList.add('nc-iframe-shell-ready');
        }
        return true;
    }

    function applyResizeGripState() {
        const wrap = document.getElementById('nc-resize-grips');
        if (!wrap) return;
        const isMax = !!window.__ncWinMaximized;
        wrap.querySelectorAll('[data-edge]').forEach(function(el) {
            const edge = String(el.dataset.edge || '').trim();
            if (isMax) {
                el.style.pointerEvents = 'none';
                el.style.cursor = 'default';
            } else {
                el.style.pointerEvents = 'auto';
                el.style.cursor = EDGE_CURSOR[edge] || 'default';
            }
        });
    }

    function ensureNavVeil() {
        if (!document.body) return false;
        let veil = document.getElementById('nc-nav-veil');
        if (!veil) {
            veil = document.createElement('div');
            veil.id = 'nc-nav-veil';
            veil.innerHTML = '<div class="nc-nav-boot-stage"><div><div class="nc-nav-brand">Nexora<span class="dot"></span></div><div class="nc-nav-sub" id="nc-nav-sub-text"></div><div class="nc-nav-progress"><div class="nc-nav-progress-bar" id="nc-nav-progress-bar"></div></div><div class="nc-nav-resource" id="nc-nav-resource">等待加载...</div></div></div>';
            document.body.appendChild(veil);
        }
        return true;
    }

    function formatNavResource(resourceName) {
        const raw = String(resourceName || '').trim();
        if (!raw) return '加载资源...';
        try {
            const u = new URL(raw, location.href);
            const p = String(u.pathname || '').trim() || '/';
            return (u.host ? (u.host + p) : p).slice(0, 180);
        } catch (_) {
            return raw.slice(0, 180);
        }
    }

    function setNavProgress(pct) {
        const bar = document.getElementById('nc-nav-progress-bar');
        if (!bar) return;
        const v = Math.max(0, Math.min(100, Number(pct) || 0));
        bar.style.width = v + '%';
    }

    function setNavResource(name) {
        const el = document.getElementById('nc-nav-resource');
        if (!el) return;
        el.textContent = formatNavResource(name);
    }

    function bindNavTrace(iframe) {
        if (navTraceTimer) {
            clearInterval(navTraceTimer);
            navTraceTimer = null;
        }
        navTraceTimer = setInterval(function() {
            try {
                const topBridge = !!(window.pywebview && window.pywebview.api);
                let iframeBridge = false;
                let iframeReady = 'n/a';
                let resource = '';
                let href = '';
                if (iframe && iframe.contentWindow) {
                    try {
                        href = String((iframe.contentWindow.location && iframe.contentWindow.location.href) || '');
                    } catch (_) {
                        href = '';
                    }
                    try {
                        iframeBridge = !!(iframe.contentWindow.pywebview && iframe.contentWindow.pywebview.api);
                    } catch (_) {
                        iframeBridge = false;
                    }
                    try {
                        iframeReady = String((iframe.contentDocument && iframe.contentDocument.readyState) || 'unknown');
                    } catch (_) {
                        iframeReady = 'unknown';
                    }
                    try {
                        const perf = iframe.contentWindow.performance && iframe.contentWindow.performance.getEntriesByType ? iframe.contentWindow.performance.getEntriesByType('resource') : [];
                        for (let i = perf.length - 1; i >= 0; i -= 1) {
                            const e = perf[i];
                            const t = String((e && e.initiatorType) || '').toLowerCase();
                            if (t === 'script' || t === 'link' || t === 'css' || t === 'fetch' || t === 'xmlhttprequest') {
                                resource = String((e && e.name) || '');
                                break;
                            }
                        }
                    } catch (_) {
                        resource = '';
                    }
                }
                const bridge = 'bridge top:' + (topBridge ? 'ok' : 'wait') + ' iframe:' + (iframeBridge ? 'ok' : 'wait') + ' doc:' + iframeReady;
                setNavResource(bridge + ' | ' + (resource || href || 'waiting'));
            } catch (_) {}
        }, 320);
    }

    function resolveNavSubText(reason) {
        const r = String(reason || '').toLowerCase();
        if (r.includes('login')) return NAV_TEXT_LOGIN;
        return NAV_TEXT_BOOTSTRAP;
    }

    function showNavVeil(reason, resourceName) {
        const now = Date.now();
        if (String(reason || '') === 'iframe-beforeunload' && (now - navLastHideAt) < 900) {
            return;
        }
        const veil = document.getElementById('nc-nav-veil');
        if (!veil) return;
        const sub = document.getElementById('nc-nav-sub-text');
        if (sub) {
            sub.textContent = resolveNavSubText(reason);
        }
        setNavResource(resourceName || reason || '加载资源...');
        if (!navProgressTimer) {
            navProgress = 8;
            setNavProgress(navProgress);
            navProgressTimer = setInterval(function() {
                navProgress = Math.min(93, navProgress + Math.max(0.5, (96 - navProgress) * 0.05));
                setNavProgress(navProgress);
            }, 180);
        }
        veil.classList.add('nc-visible');
        veil.setAttribute('data-reason', String(reason || ''));
        try { console.log('[NexoraNavVeil] show reason=' + String(reason || '') + ' resource=' + formatNavResource(resourceName || reason || '')); } catch (_) {}
    }

    function hideNavVeil(reason) {
        const veil = document.getElementById('nc-nav-veil');
        if (!veil) return;
        navLastHideAt = Date.now();
        if (navProgressTimer) {
            clearInterval(navProgressTimer);
            navProgressTimer = null;
        }
        setNavProgress(100);
        veil.classList.remove('nc-visible');
        veil.setAttribute('data-hide-reason', String(reason || ''));
        try { console.log('[NexoraNavVeil] hide reason=' + String(reason || '')); } catch (_) {}
    }

    function isLoginLikeActionTarget(el) {
        if (!el) return false;
        const txt = String((el.innerText || el.textContent || '')).toLowerCase();
        const v = String(el.value || '').toLowerCase();
        const id = String(el.id || '').toLowerCase();
        const cls = String(el.className || '').toLowerCase();
        const payload = txt + ' ' + v + ' ' + id + ' ' + cls;
        return /login|sign\s*in|log\s*in|\u767b\u5f55|\u767b\u5165/.test(payload);
    }

    function isChatUiReady() {
        try {
            if (!document.body) return false;
            const hasChatSignals = !!(
                document.querySelector('.app-container') ||
                document.querySelector('.messages-area') ||
                document.querySelector('[id*="chat" i]')
            );
            const hasLoginSignals = !!(
                document.querySelector('input[type="password"]') ||
                document.querySelector('form[action*="login" i], form[id*="login" i], form[class*="login" i]')
            );
            return hasChatSignals || hasLoginSignals;
        } catch (_) {
            return false;
        }
    }

  function syncState() {
        applyResizeGripState();
  }

    function applyMobileOverlayFix() {
        const mobile = window.innerWidth <= 980;
        const selectors = [
            '#sidebar', '.sidebar', '#knowledgePanel', '#filePanel', '#notesPanel',
            '.knowledge-sidebar', '.mobile-header-menu-panel',
            '[id*="sidebar" i]', '[class*="sidebar" i]',
            '[id*="panel" i]', '[class*="panel" i]',
            '[id*="drawer" i]', '[class*="drawer" i]',
            '[id*="toast" i]', '[class*="toast" i]'
        ].join(',');
        document.querySelectorAll(selectors).forEach(function(el) {
            if (!el || !el.style) return;
            if (!mobile) {
                if (el.dataset && el.dataset.ncOffsetApplied === '1') {
                    el.style.removeProperty('top');
                    el.style.removeProperty('max-height');
                    el.style.removeProperty('margin-top');
                    el.dataset.ncOffsetApplied = '0';
                }
                return;
            }
            const cs = window.getComputedStyle(el);
            if (!cs || cs.position !== 'fixed') return;
            const top = Number.parseFloat(cs.top || '0');
            if (Number.isFinite(top) && top > 6) return;
            el.style.setProperty('top', 'var(--nc-titlebar-h)', 'important');
            el.style.setProperty('max-height', 'calc(100vh - var(--nc-titlebar-h))', 'important');
            if (el.dataset) {
                el.dataset.ncOffsetApplied = '1';
            }
        });
    }

  function ensureAll() {
    syncViewportMode();
    const styleOk = ensureStyle();
    const barOk = ensureBar();
        const shellOk = ensureIframeShell();
    const gripsOk = ensureResizeGrips();
    ensureNavVeil();
        if (styleOk && barOk && shellOk && gripsOk) syncState();
        if (styleOk && barOk && shellOk && gripsOk) {
            applyMobileOverlayFix();
      // First-frame stabilization: some WebView2 builds need explicit relayout.
      try { window.dispatchEvent(new Event('resize')); } catch (_) {}
      setTimeout(function() { try { window.dispatchEvent(new Event('resize')); } catch (_) {} }, 60);
      setTimeout(function() { try { window.dispatchEvent(new Event('resize')); } catch (_) {} }, 180);
    }
        return styleOk && barOk && shellOk && gripsOk;
  }

  if (!ensureAll()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { ensureAll(); }, { once: true });
    } else {
      setTimeout(function() { ensureAll(); }, 80);
    }
  }

        // Race app mounting on first navigation: try several early passes.
        (function fastBootstrap() {
                let n = 0;
                const t = setInterval(function() {
                        n += 1;
                        try { ensureAll(); } catch (_) {}
                        if ((document.getElementById('nc-titlebar') && document.getElementById('nc-app-frame')) || n >= 90) {
                                clearInterval(t);
                        }
                }, 16);
        })();

    // Avoid heavy subtree observers on small windows: they cause stutter.
    setInterval(function() { applyMobileOverlayFix(); }, 900);

    let resizeTimer = null;
    window.addEventListener('resize', function() {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            resizeTimer = null;
            syncViewportMode();
            applyMobileOverlayFix();
        }, 160);
    });

    window.addEventListener('pageshow', function() {
        setTimeout(function() { ensureAll(); }, 0);
        setTimeout(function() { ensureAll(); }, 120);
    });

    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            setTimeout(function() { ensureAll(); }, 0);
        }
    });

    setInterval(function() {
        if (!document.getElementById('nc-titlebar')) {
            ensureAll();
        }
    }, 1000);

    document.addEventListener('submit', function(e) {
        const form = e && e.target;
        if (!form || !form.querySelector) return;
        if (form.querySelector('input[type="password"]')) {
            showNavVeil('top-submit-password');
        }
    }, true);

    document.addEventListener('click', function(e) {
        const target = e && e.target;
        const btn = target && target.closest ? target.closest('button, [role="button"], input[type="submit"], input[type="button"], a') : null;
        if (btn && isLoginLikeActionTarget(btn)) {
            showNavVeil('top-login-action');
        }
    }, true);

    window.addEventListener('beforeunload', function() {
        showNavVeil('top-beforeunload');
    });

    window.addEventListener('pageshow', function() {
        if (isChatUiReady()) {
            hideNavVeil('top-pageshow-ready');
        }
    });

    setInterval(function() {
        const veil = document.getElementById('nc-nav-veil');
        if (!veil || !veil.classList.contains('nc-visible')) return;
        if (isChatUiReady()) {
            hideNavVeil('top-interval-ready');
        }
    }, 300);
})();"""
    _TITLEBAR_JS = _TITLEBAR_JS.replace("__NC_WINDOW_MODE__", _WINDOW_MODE)
    _TITLEBAR_JS = _TITLEBAR_JS.replace("__NC_MSG_BOOTSTRAP__", json.dumps(_msg_bootstrap, ensure_ascii=False))
    _TITLEBAR_JS = _TITLEBAR_JS.replace("__NC_MSG_LOGIN__", json.dumps(_msg_login, ensure_ascii=False))
    _TITLEBAR_JS = _TITLEBAR_JS.replace("__NC_IFRAME_SHELL_ENABLED__", "true" if _iframe_shell_enabled else "false")
    print(f"[NexoraShell] iframe_shell_enabled={_iframe_shell_enabled}")

    _PAGE_PATCH_JS = r"""(function() {
  function ensureHead() {
    if (document.head) return true;
    if (!document.documentElement) return false;
    const h = document.createElement('head');
    document.documentElement.insertBefore(h, document.documentElement.firstChild);
    return true;
  }
  function ensureStyle() {
    if (!ensureHead()) return false;
    let s = document.getElementById('nc-page-shell-style');
    if (!s) {
      s = document.createElement('style');
      s.id = 'nc-page-shell-style';
      document.head.appendChild(s);
    }
    s.textContent = `
      ::selection { background: #5b3a21; color: #ffe7bf; }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.18); border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.32); }
      .messages-area,
      .message,
      .message-content,
      .content-body,
      .thinking-content,
      #knowledgeViewer,
      .cm-editor,
      .cm-scroller,
      .note-text,
      .note-text * {
        user-select: text !important;
        -webkit-user-select: text !important;
      }
      .mobile-header-menu-panel {
        z-index: 2147483500 !important;
      }
            html.nc-desktop-mode #toggleSidebarMobile,
            html.nc-desktop-mode .mobile-header-menu {
        display: none !important;
      }
            html.nc-desktop-mode #settingsModal .settings-modal-custom {
        width: min(960px, calc(100vw - 64px)) !important;
        max-width: 960px !important;
        min-width: 760px !important;
        height: calc(100vh - var(--nc-titlebar-h) - 72px) !important;
        min-height: 520px !important;
        max-height: calc(100vh - var(--nc-titlebar-h) - 72px) !important;
        margin: 0 auto !important;
        box-sizing: border-box !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
      }
            html.nc-desktop-mode #settingsModal.modal-backdrop {
        align-items: flex-start !important;
        justify-content: center !important;
                padding-top: calc(var(--nc-titlebar-h) + 16px) !important;
                padding-bottom: 16px !important;
        box-sizing: border-box !important;
      }
            html.nc-desktop-mode #settingsModal .modal-body {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
      }
            html.nc-desktop-mode #settingsModal .admin-shell {
        display: grid !important;
        grid-template-columns: 220px minmax(0, 1fr) !important;
        gap: 0 !important;
        height: 100% !important;
        min-height: 0 !important;
      }
            html.nc-desktop-mode #settingsModal .settings-nav,
            html.nc-desktop-mode #settingsModal .admin-nav {
        width: 220px !important;
        min-width: 220px !important;
        max-width: 220px !important;
        display: flex !important;
        flex-direction: column !important;
        height: 100% !important;
        min-height: 0 !important;
        overflow-y: auto !important;
      }
            html.nc-desktop-mode #settingsModal .settings-content,
            html.nc-desktop-mode #settingsModal .admin-content {
        min-width: 0 !important;
        height: 100% !important;
        min-height: 0 !important;
        overflow: auto !important;
      }
            html.nc-desktop-mode #settingsModal .admin-users-layout {
        display: grid !important;
        grid-template-columns: 280px minmax(0, 1fr) !important;
      }
            html.nc-desktop-mode .modal-backdrop .modal {
        max-height: calc(100vh - 16px) !important;
        overflow: hidden !important;
      }
    `;
    return true;
  }
    if (document.documentElement) {
        const desktop = window.innerWidth >= 980;
        document.documentElement.classList.toggle('nc-desktop-mode', desktop);
        document.documentElement.classList.toggle('nc-mobile-mode', !desktop);
    }
  ensureStyle();
})();"""

    def on_shown():
        if not _USE_CUSTOM_TITLEBAR:
            return
        wintitle.install(win, emulate_snap=_USE_FRAMELESS)
        if _USE_FRAMELESS:
            threading.Thread(target=lambda: (time.sleep(0.06), wintitle.enforce_borderless_chrome(win), wintitle.force_frame_refresh(win)), daemon=True).start()
        threading.Thread(target=lambda: wintitle.set_webview_dark_background(win, 5, 5, 5), daemon=True).start()
        _use_native_nav_cover = str(config.get("native_navigation_cover", False)).strip().lower() in {"1", "true", "on", "yes"}
        if _use_native_nav_cover:
            threading.Thread(target=lambda: wintitle.install_navigation_cover(win, top_offset=36, r=5, g=5, b=5, hide_delay_ms=260), daemon=True).start()
            print("[NexoraNav] native navigation cover enabled")
        else:
            print("[NexoraNav] native navigation cover disabled (using JS veil only)")
        if not _USE_FRAMELESS:
            def _ensure_resizable_retry():
                for _ in range(80):
                    try:
                        if wintitle.ensure_resizable_frame(win):
                            wintitle.force_frame_refresh(win)
                            return
                    except Exception:
                        pass
                    time.sleep(0.03)
            threading.Thread(target=_ensure_resizable_retry, daemon=True).start()
        if _WINDOW_MODE == "custom":
            def _apply_custom_chrome_retry():
                # Keep native caption until web titlebar is actually present,
                # so startup never shows a no-titlebar gap.
                for idx in range(140):
                    web_bar_ready = False
                    try:
                        ready_js = (
                            "(function(){"
                            "return !!(document.getElementById('nc-boot-bar') || document.getElementById('nc-titlebar'));"
                            "})();"
                        )
                        web_bar_ready = bool(win.evaluate_js(ready_js))
                    except Exception:
                        web_bar_ready = False
                    if not web_bar_ready and idx < 110:
                        time.sleep(0.03)
                        continue
                    try:
                        if wintitle.enable_custom_chrome(win):
                            # First-screen stabilization: force NC frame recompute
                            # a few times to avoid "thick border until first state change".
                            wintitle.force_frame_refresh(win)
                            if idx < 6:
                                time.sleep(0.04)
                                wintitle.force_frame_refresh(win)
                            return
                    except Exception:
                        pass
                    time.sleep(0.03)
            threading.Thread(target=_apply_custom_chrome_retry, daemon=True).start()
        # Use webview-rendered titlebar for both frameless and custom mode.
        # Keep native WndProc hooks from wintitle.install for drag/resize/snap behavior.
        try:
            wintitle.add_startup_script(win, _TITLEBAR_JS)
        except Exception:
            pass
        try:
            wintitle.add_startup_script(win, _EARLY_PAGE_ACCEL_JS)
        except Exception:
            pass
        threading.Thread(target=_titlebar_keepalive_loop, args=(win, _TITLEBAR_JS, 1.2), daemon=True).start()
        if _WINDOW_MODE == "custom":
            try:
                wintitle.add_startup_script(win, _PAGE_PATCH_JS)
            except Exception:
                pass
        if _USE_CUSTOM_TITLEBAR:
            with _RUNTIME_STARTUP_ASSERT_LOCK:
                _RUNTIME_STARTUP_ASSERTED.set()
        # Bootstrap shell mode: navigate exactly once to the real page.
        if _USE_BOOTSTRAP_SHELL and not _NAV_STARTED.is_set():
            if _PERSISTENT_OUTER_SHELL:
                _NAV_STARTED.set()
                print("[NexoraShell] persistent outer shell enabled; skip top-level load_url")
                return
            def _navigate_to_nexora_once():
                # Let WndProc/frame style settle before first real page render.
                time.sleep(0.22)
                if _NAV_STARTED.is_set():
                    return
                _NAV_STARTED.set()
                try:
                    wintitle.force_frame_refresh(win)
                except Exception:
                    pass
                try:
                    wintitle.ensure_resizable_frame(win)
                except Exception:
                    pass
                try:
                    wintitle.nudge_window_size(win)
                except Exception:
                    pass
                try:
                    wintitle.force_frame_refresh(win)
                except Exception:
                    pass
                try:
                    nav_extra = {"nc_iframe_content": "1"} if _iframe_shell_enabled else None
                    win.load_url(_build_entry_url(runtime_base_url, nav_extra))
                except Exception:
                    pass
            threading.Thread(target=_navigate_to_nexora_once, daemon=True).start()
    win.events.shown += on_shown

    _poll_session = requests.Session()

    def on_loaded():
        """页面加载后注入 Cookie，注册工具，启动轮询 loop"""
        t_loaded = time.time()
        t_loaded_perf = int(time.perf_counter() * 1000)
        def _phase(tag: str):
            try:
                ms = int((time.time() - t_loaded) * 1000)
                print(f"[NexoraLoad] {tag} +{ms}ms")
            except Exception:
                pass

        _phase("on_loaded enter")
        try:
            href = str(win.evaluate_js("location.href") or "")
        except Exception:
            href = ""

        try:
            print(f"[NexoraNav] loaded href={href}")
        except Exception:
            pass

        href_lower = href.lower()
        _is_runtime_page = bool(runtime_host and runtime_host in href_lower)

        if _USE_CUSTOM_TITLEBAR:
            try:
                if href_lower and href_lower != "about:blank":
                    wintitle.release_navigation_cover(win, hide=True)
                else:
                    wintitle.release_navigation_cover(win, hide=False)
                _phase("release_navigation_cover done")
            except Exception:
                pass

        _should_hide_doc_boot_late = False
        if _USE_CUSTOM_TITLEBAR:
            try:
                if href_lower and href_lower != "about:blank" and _is_runtime_page:
                    _should_hide_doc_boot_late = True
                    _phase("doc-boot hide deferred")
                else:
                    win.evaluate_js("window.__ncHideDocBoot&&window.__ncHideDocBoot('python-loaded');")
                    print(f"[NexoraNav] doc-boot hidden at loaded href={href}")
                    _phase("doc-boot hidden")
            except Exception as ex:
                try:
                    print(f"[NexoraNav] doc-boot hide failed href={href} err={ex}")
                except Exception:
                    pass

        # 非目标站点（或 bootstrap 页面）不执行注入逻辑
        if not _is_runtime_page:
            try:
                print(f"[NexoraNav] loaded skipped runtime_host={runtime_host} href={href}")
                _phase("skip non-runtime host")
            except Exception:
                pass
            return

        # Startup scripts are asserted during on_shown; keep loaded path non-blocking.
        if _USE_CUSTOM_TITLEBAR:
            _phase("startup scripts already asserted" if _RUNTIME_STARTUP_ASSERTED.is_set() else "startup scripts pending (shown)")

        # 在 Nexora 真实页面上注入标题栏
        if _USE_FRAMELESS:
            threading.Thread(target=_inject_titlebar_with_retry, args=(win, _TITLEBAR_JS, 15, 0.2), daemon=True).start()
            threading.Thread(target=lambda: (time.sleep(0.12), wintitle.sync_max_state(win)), daemon=True).start()
            threading.Thread(target=lambda: (time.sleep(0.22), wintitle.force_frame_refresh(win)), daemon=True).start()
            threading.Thread(target=lambda: (time.sleep(0.26), wintitle.enforce_borderless_chrome(win), wintitle.force_frame_refresh(win)), daemon=True).start()
        elif _USE_CUSTOM_TITLEBAR:
            threading.Thread(target=_inject_titlebar_with_retry, args=(win, _TITLEBAR_JS, 12, 0.2), daemon=True).start()
            threading.Thread(target=_inject_titlebar_with_retry, args=(win, _PAGE_PATCH_JS, 8, 0.2, "nc-page-shell-style"), daemon=True).start()
            # One more late frame refresh after first real page load.
            threading.Thread(target=lambda: (time.sleep(0.18), wintitle.force_frame_refresh(win)), daemon=True).start()
            threading.Thread(target=lambda: (time.sleep(0.24), wintitle.ensure_resizable_frame(win), wintitle.force_frame_refresh(win)), daemon=True).start()
            if _WINDOW_MODE == "custom":
                # Some systems reset style bits after first document attach;
                # re-assert custom chrome to keep resize borders stable.
                threading.Thread(
                    target=lambda: (time.sleep(0.22), wintitle.enable_custom_chrome(win), wintitle.force_frame_refresh(win)),
                    daemon=True,
                ).start()
        if _USE_CUSTOM_TITLEBAR and not _FIRST_LAYOUT_NUDGED.is_set():
            _FIRST_LAYOUT_NUDGED.set()
            def _stabilize_first_layout():
                # Some systems only settle non-client metrics after first interactive resize.
                # Proactively emulate that once during initial load for both frameless/custom.
                time.sleep(0.20)
                wintitle.force_frame_refresh(win)
                time.sleep(0.10)
                wintitle.nudge_window_size(win)
                wintitle.force_frame_refresh(win)
                time.sleep(0.12)
                wintitle.nudge_window_size(win)
                wintitle.force_frame_refresh(win)
                wintitle.sync_max_state(win)

            threading.Thread(target=_stabilize_first_layout, daemon=True).start()

        try:
            win.evaluate_js("""(function() {
  function api() {
    return (window.pywebview && window.pywebview.api) ? window.pywebview.api : null;
  }

  if (!window.__nexoraCodeModelSyncBound) {
    window.__nexoraCodeModelSyncBound = true;
    document.addEventListener('click', function(e) {
      const chip = e.target && e.target.closest ? e.target.closest('.model-chip') : null;
      if (!chip) return;
      const modelId = String(chip.dataset.modelId || '').trim();
      if (!modelId) return;
      const a = api();
      if (a && a.set_preferred_model) a.set_preferred_model(modelId);
    }, true);
  }

  const a = api();
  if (a && a.get_preferred_model) {
    a.get_preferred_model().then(function(d) {
      const saved = String((d && d.model_id) || '').trim();
      const current = String(localStorage.getItem('selectedModel') || '').trim();
      if (!saved && current && a.set_preferred_model) {
        a.set_preferred_model(current);
        return;
      }
      if (!saved) return;
      localStorage.setItem('selectedModel', saved);
      let tryCount = 0;
      const timer = setInterval(function() {
        tryCount += 1;
        let applied = false;
        const chips = document.querySelectorAll('.model-chip[data-model-id]');
        chips.forEach(function(chip) {
          if (applied) return;
          const mid = String(chip.dataset.modelId || '').trim();
          if (mid === saved) {
            chip.click();
            applied = true;
          }
        });
        if (applied || tryCount > 30) clearInterval(timer);
      }, 250);
    }).catch(function() {});
  }
})();""")
        except Exception:
            pass

        toast_msg = _pop_pending_toast()
        if toast_msg:
            _show_toast_in_page(win, toast_msg)

        if not _ASSET_WARM_STARTED.is_set():
            _ASSET_WARM_STARTED.set()
            urls = _collect_asset_urls(win)
            if urls:
                threading.Thread(
                    target=_check_asset_updates_async,
                    args=(win, runtime_host, href, urls),
                    daemon=True,
                ).start()

        if not _acquire_bootstrap_slot():
            try:
                dt = int((time.time() - t_loaded) * 1000)
                print(f"[NexoraNav] bootstrap slot busy, skip in {dt}ms href={href}")
            except Exception:
                pass
            return

        if _should_hide_doc_boot_late:
            try:
                win.evaluate_js("window.__ncHideDocBoot&&window.__ncHideDocBoot('runtime-ready');")
                print(f"[NexoraNav] doc-boot hidden at runtime-ready href={href}")
                _phase("doc-boot hidden (late)")
            except Exception as ex:
                try:
                    print(f"[NexoraNav] doc-boot late hide failed href={href} err={ex}")
                except Exception:
                    pass
        payload = {
            "token": agent_token,
            "callback_url": f"http://localhost:{LOCAL_PORT}",
            "tools": tools,
        }
        payload_js_literal = json.dumps(payload, ensure_ascii=False)

        try:
            win.evaluate_js(f"""(function() {{
    document.cookie = 'nexoracode_agent={agent_token}; path=/; SameSite=Lax';
    try {{
        const payload = {payload_js_literal};
        const state = window.__ncLocalAgentRegisterState || (window.__ncLocalAgentRegisterState = {{
            ok: false,
            inFlight: false,
            lastAttemptTs: 0,
            retryTimer: null,
            failCount: 0
        }});
        const scheduleRetry = function() {{
            if (state.ok || state.retryTimer) return;
            state.retryTimer = setInterval(function() {{
                try {{
                    if (state.ok || state.inFlight || !window.__ncAttemptLocalAgentRegister) return;
                    window.__ncAttemptLocalAgentRegister('retry-timer');
                }} catch (_) {{}}
            }}, 3000);
        }};
        window.__ncAttemptLocalAgentRegister = function(reason) {{
            const why = String(reason || 'unknown');
            if (state.ok) return Promise.resolve({{ ok: true, status: 200, skipped: true, reason: why }});
            if (state.inFlight) return Promise.resolve({{ ok: false, skipped: true, reason: why }});
            const now = Date.now();
            if ((now - Number(state.lastAttemptTs || 0)) < 1200) {{
                return Promise.resolve({{ ok: false, skipped: true, throttled: true, reason: why }});
            }}
            state.inFlight = true;
            state.lastAttemptTs = now;
            return fetch('/api/local_agent/register', {{
                method: 'POST',
                credentials: 'include',
                headers: {{ 'Content-Type': 'application/json' }},
                body: JSON.stringify(payload)
            }})
            .then(function(resp) {{
                return resp.text().then(function(t) {{
                    return {{ ok: resp.ok, status: resp.status, body: t, reason: why }};
                }});
            }})
            .then(function(info) {{
                state.inFlight = false;
                if (info.ok) {{
                    state.ok = true;
                    state.failCount = 0;
                    if (state.retryTimer) {{
                        clearInterval(state.retryTimer);
                        state.retryTimer = null;
                    }}
                }} else {{
                    state.failCount = Number(state.failCount || 0) + 1;
                    scheduleRetry();
                }}
                try {{ console.log('[NexoraCode] local_agent/register(' + why + ') -> status=' + String(info.status) + ' ok=' + String(info.ok)); }} catch (_) {{}}
                return info;
            }})
            .catch(function(err) {{
                state.inFlight = false;
                state.failCount = Number(state.failCount || 0) + 1;
                scheduleRetry();
                try {{ console.log('[NexoraCode] local_agent/register(' + why + ') failed: ' + String(err || 'unknown')); }} catch (_) {{}}
                return {{ ok: false, status: 0, error: String(err || 'unknown'), reason: why }};
            }});
        }};
        scheduleRetry();
        window.__ncAttemptLocalAgentRegister('bootstrap');
    }} catch (_) {{}}
}})();
""")
        except Exception:
            _release_bootstrap_slot()
            return
        # 同步 session cookie 到 requests session（复用 WebView 登录态）
        # 通过 JS 取 cookie 后写入 requests session
        def _sync_cookies():
            try:
                try:
                    print(f"[NexoraLoad] sync_cookies begin href={href}")
                except Exception:
                    pass
                # 等待 JS 注册完成后再开始轮询
                time.sleep(2)
                try:
                    print("[NexoraLoad] sync_cookies after wait 2000ms")
                except Exception:
                    pass
                cookie_str = win.evaluate_js("document.cookie")
                try:
                    ln = len(str(cookie_str or ""))
                    print(f"[NexoraLoad] cookie length={ln}")
                except Exception:
                    pass
                if cookie_str:
                    for part in cookie_str.split(";"):
                        part = part.strip()
                        if "=" in part:
                            k, v = part.split("=", 1)
                            _poll_session.cookies.set(k.strip(), v.strip(), domain=runtime_host, path="/")
                if _POLL_STARTED.is_set():
                    try:
                        print("[NexoraLoad] poll already started")
                    except Exception:
                        pass
                    return
                _POLL_STARTED.set()
                try:
                    dt = int((time.time() - t_loaded) * 1000)
                    dt2 = int(time.perf_counter() * 1000) - t_loaded_perf
                    print(f"[NexoraNav] bootstrap done in {dt}ms href={href} loaded_to_done={dt2}ms")
                except Exception:
                    pass
                # 这里的 base_url 必须是远端地址，不能经过本地 Flask 代理（requests模块无法代理 websocket）
                remote_base_url = str(config.get("nexora_url", DEFAULT_NEXORA_URL) or DEFAULT_NEXORA_URL).strip()
                if not remote_base_url: remote_base_url = DEFAULT_NEXORA_URL
                
                poll_thread = threading.Thread(
                    target=_agent_tunnel_loop,
                    args=(registry, agent_token, remote_base_url),
                    daemon=True,
                )
                poll_thread.start()
            finally:
                _release_bootstrap_slot()

        threading.Thread(target=_sync_cookies, daemon=True).start()

    win.events.loaded += on_loaded
    _STORAGE_PATH.mkdir(parents=True, exist_ok=True)
    webview.start(debug=devtools_enabled, private_mode=False, storage_path=str(_STORAGE_PATH))
    _STOP_POLL.set()


if __name__ == "__main__":
    main()
