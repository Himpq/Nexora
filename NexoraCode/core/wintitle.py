"""
wintitle.py  -  Windows frameless window native behaviour

Provides:
    install(win)            - subclass WndProc for resize edges + WM_SIZE notify
  toggle_max_restore(win) - native ShowWindow maximize / restore toggle
  start_window_drag(win)  - ReleaseCapture+SendMessage(NCLBUTTONDOWN) on UI thread
  enable_app_region(win)  - enable WebView2 -webkit-app-region CSS support
  sync_max_state(win)     - push current max-state to injected titlebar JS
  is_window_maximized(win)
  add_startup_script(win, script)
  snap_window(win, mode="max"|"restore"|"left"|"right")

Only active on Windows; every function is a no-op on other platforms.
"""

import sys
import threading
import time
import os

__all__ = [
    "install",
    "enable_custom_chrome",
    "force_frame_refresh",
    "minimize_window",
    "toggle_max_restore",
    "start_window_drag",
    "enable_app_region",
    "sync_max_state",
    "is_window_maximized",
    "add_startup_script",
    "snap_window",
    "set_window_topmost",
    "ensure_resizable_frame",
    "enforce_borderless_chrome",
    "start_window_resize",
    "titlebar_double_click",
    "nudge_window_size",
    "set_webview_dark_background",
    "install_navigation_cover",
    "release_navigation_cover",
]

if sys.platform != "win32":
    def install(win, emulate_snap=True, borderless_mode=False):
        pass

    def enable_custom_chrome(win):
        return False

    def force_frame_refresh(win):
        return False

    def minimize_window(win):
        return False

    def toggle_max_restore(win):
        return False

    def start_window_drag(win):
        return False

    def enable_app_region(win):
        return False

    def sync_max_state(win):
        return False

    def is_window_maximized(win):
        return False

    def add_startup_script(win, script):
        return False

    def snap_window(win, mode="max", screen_x=None, screen_y=None):
        return False

    def set_window_topmost(win, enabled=True):
        return False

    def ensure_resizable_frame(win):
        return False

    def enforce_borderless_chrome(win):
        return False

    def start_window_resize(win, edge="right"):
        return False

    def titlebar_double_click(win):
        return False

    def nudge_window_size(win):
        return False

    def set_webview_dark_background(win, r=5, g=5, b=5):
        return False

    def install_navigation_cover(win, top_offset=36, r=5, g=5, b=5, hide_delay_ms=220):
        return False

    def release_navigation_cover(win, hide=True):
        return False
else:
    import ctypes
    import ctypes.wintypes as wt
    from ctypes import WINFUNCTYPE, windll

    # Win32 constants
    WM_SIZE = 0x0005
    WM_NCCALCSIZE = 0x0083
    WM_NCHITTEST = 0x0084
    WM_GETMINMAXINFO = 0x0024
    WM_SETCURSOR = 0x0020
    WM_SYSCOMMAND = 0x0112
    WM_NCLBUTTONDOWN = 0x00A1
    WM_NCLBUTTONDBLCLK = 0x00A3
    WM_EXITSIZEMOVE = 0x0232

    HTCLIENT = 1
    HTCAPTION = 2
    HTSIZE = 4
    HTLEFT, HTRIGHT = 10, 11
    HTTOP, HTTOPLEFT, HTTOPRIGHT = 12, 13, 14
    HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT = 15, 16, 17
    _RESIZE_HITS = {
        HTLEFT,
        HTRIGHT,
        HTTOP,
        HTTOPLEFT,
        HTTOPRIGHT,
        HTBOTTOM,
        HTBOTTOMLEFT,
        HTBOTTOMRIGHT,
    }

    GWLP_WNDPROC = -4
    GWL_STYLE = -16

    SW_SHOWMAXIMIZED = 3
    SW_RESTORE = 9
    SW_MINIMIZE = 6
    SC_MINIMIZE = 0xF020
    SC_MAXIMIZE = 0xF030
    SC_RESTORE = 0xF120
    SC_SIZE = 0xF000

    MONITOR_DEFAULTTONEAREST = 2
    SWP_NOSIZE = 0x0001
    SWP_NOMOVE = 0x0002
    SWP_NOZORDER = 0x0004
    SWP_NOACTIVATE = 0x0010
    SWP_FRAMECHANGED = 0x0020
    HWND_TOPMOST = wt.HWND(-1)
    HWND_NOTOPMOST = wt.HWND(-2)

    WS_CAPTION = 0x00C00000
    WS_THICKFRAME = 0x00040000
    WS_BORDER = 0x00800000
    WS_MINIMIZEBOX = 0x00020000
    WS_MAXIMIZEBOX = 0x00010000
    WS_SYSMENU = 0x00080000
    WS_SIZEBOX = 0x00040000

    SM_CXFRAME = 32
    SM_CYFRAME = 33
    SM_CXPADDEDBORDER = 92

    TITLEBAR_H = 36
    BORDER_W = 10
    BTN_AREA_W = 140  # 3 buttons * 46px ~= 138
    SNAP_EDGE_THRESHOLD = 14
    HITTEST_EDGE_BAND = 10
    HITTEST_CORNER_BAND = 14

    # Debug switch for first-frame offset diagnostics.
    # Set NEXORA_WIN_DEBUG=0 to silence logs.
    _WIN_DEBUG = str(os.environ.get("NEXORA_WIN_DEBUG", "0") or "0").strip().lower() not in {"0", "false", "off", "no"}
    _UI_CMD_LOG = str(os.environ.get("NEXORA_UI_CMD_LOG", "1") or "1").strip().lower() not in {"0", "false", "off", "no"}
    _HITTEST_TRACE = str(os.environ.get("NEXORA_HITTEST_TRACE", "0") or "0").strip().lower() not in {"0", "false", "off", "no"}
    _NAV_TRACE = str(os.environ.get("NEXORA_NAV_TRACE", "1") or "1").strip().lower() not in {"0", "false", "off", "no"}
    _WIN_DEBUG_LIMIT = 240
    _WIN_DEBUG_COUNTERS = {}
    _TRACE_COUNTERS = {}

    _WndProcType = WINFUNCTYPE(ctypes.c_ssize_t, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM)

    _STATE = {}      # hwnd -> {"proc": wndproc_closure, "old": old_wndproc, "emulate_snap": bool}
    _WIN_HWND = {}   # id(win) -> hwnd
    _MANUAL_MAX = {} # hwnd -> {"restore": (l,t,w,h), "work": (l,t,w,h)}
    _CUSTOM_CHROME = set()
    _CHILD_STATE = {}  # child_hwnd -> {"proc": ..., "old": ..., "parent": top_hwnd}
    _NAV_COVER_STATE = {}  # id(win) -> strong refs for native navigation cover

    class MONITORINFO(ctypes.Structure):
        _fields_ = [
            ("cbSize", wt.DWORD),
            ("rcMonitor", wt.RECT),
            ("rcWork", wt.RECT),
            ("dwFlags", wt.DWORD),
        ]

    class NCCALCSIZE_PARAMS(ctypes.Structure):
        _fields_ = [
            ("rgrc", wt.RECT * 3),
            ("lppos", ctypes.c_void_p),
        ]

    class MINMAXINFO(ctypes.Structure):
        _fields_ = [
            ("ptReserved", wt.POINT),
            ("ptMaxSize", wt.POINT),
            ("ptMaxPosition", wt.POINT),
            ("ptMinTrackSize", wt.POINT),
            ("ptMaxTrackSize", wt.POINT),
        ]

    class WINDOWPLACEMENT(ctypes.Structure):
        _fields_ = [
            ("length", wt.UINT),
            ("flags", wt.UINT),
            ("showCmd", wt.UINT),
            ("ptMinPosition", wt.POINT),
            ("ptMaxPosition", wt.POINT),
            ("rcNormalPosition", wt.RECT),
        ]

    # Win32 API declarations
    _GetWindowLongPtrW = windll.user32.GetWindowLongPtrW
    _GetWindowLongPtrW.restype = ctypes.c_ssize_t
    _GetWindowLongPtrW.argtypes = [wt.HWND, ctypes.c_int]

    _SetWindowLongPtrW = windll.user32.SetWindowLongPtrW
    _SetWindowLongPtrW.restype = ctypes.c_ssize_t
    _SetWindowLongPtrW.argtypes = [wt.HWND, ctypes.c_int, ctypes.c_ssize_t]

    _CallWindowProcW = windll.user32.CallWindowProcW
    _CallWindowProcW.restype = ctypes.c_ssize_t
    _CallWindowProcW.argtypes = [ctypes.c_ssize_t, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]

    _IsWindow = windll.user32.IsWindow
    _IsWindow.restype = wt.BOOL
    _IsWindow.argtypes = [wt.HWND]

    _ReleaseCapture = windll.user32.ReleaseCapture
    _ReleaseCapture.restype = wt.BOOL
    _ReleaseCapture.argtypes = []

    _SendMessageW = windll.user32.SendMessageW
    _SendMessageW.restype = ctypes.c_ssize_t
    _SendMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]

    _PostMessageW = windll.user32.PostMessageW
    _PostMessageW.restype = wt.BOOL
    _PostMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]

    _ShowWindow = windll.user32.ShowWindow
    _ShowWindow.restype = wt.BOOL
    _ShowWindow.argtypes = [wt.HWND, ctypes.c_int]

    _IsZoomed = windll.user32.IsZoomed
    _IsZoomed.restype = wt.BOOL
    _IsZoomed.argtypes = [wt.HWND]

    _GetWindowRect = windll.user32.GetWindowRect
    _GetWindowRect.restype = wt.BOOL
    _GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]

    _GetWindowPlacement = windll.user32.GetWindowPlacement
    _GetWindowPlacement.restype = wt.BOOL
    _GetWindowPlacement.argtypes = [wt.HWND, ctypes.POINTER(WINDOWPLACEMENT)]

    _MonitorFromWindow = windll.user32.MonitorFromWindow
    _MonitorFromWindow.restype = wt.HMONITOR
    _MonitorFromWindow.argtypes = [wt.HWND, wt.DWORD]

    _GetMonitorInfoW = windll.user32.GetMonitorInfoW
    _GetMonitorInfoW.restype = wt.BOOL
    _GetMonitorInfoW.argtypes = [wt.HMONITOR, ctypes.POINTER(MONITORINFO)]

    _SetWindowPos = windll.user32.SetWindowPos
    _SetWindowPos.restype = wt.BOOL
    _SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]

    _SetForegroundWindow = windll.user32.SetForegroundWindow
    _SetForegroundWindow.restype = wt.BOOL
    _SetForegroundWindow.argtypes = [wt.HWND]

    _GetCursorPos = windll.user32.GetCursorPos
    _GetCursorPos.restype = wt.BOOL
    _GetCursorPos.argtypes = [ctypes.POINTER(wt.POINT)]

    _GetAncestor = windll.user32.GetAncestor
    _GetAncestor.restype = wt.HWND
    _GetAncestor.argtypes = [wt.HWND, wt.UINT]

    _GetClassNameW = windll.user32.GetClassNameW
    _GetClassNameW.restype = ctypes.c_int
    _GetClassNameW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]

    _EnumChildWindows = windll.user32.EnumChildWindows
    _EnumChildWindows.restype = wt.BOOL
    _EnumChildWindows.argtypes = [wt.HWND, ctypes.c_void_p, wt.LPARAM]

    GA_ROOT = 2

    _GetSystemMetrics = windll.user32.GetSystemMetrics
    _GetSystemMetrics.restype = ctypes.c_int
    _GetSystemMetrics.argtypes = [ctypes.c_int]

    try:
        _DwmSetWindowAttribute = windll.dwmapi.DwmSetWindowAttribute
        _DwmSetWindowAttribute.restype = wt.HRESULT
        _DwmSetWindowAttribute.argtypes = [wt.HWND, wt.DWORD, wt.LPCVOID, wt.DWORD]
    except Exception:
        _DwmSetWindowAttribute = None

    DWMWA_BORDER_COLOR = 34
    DWMWA_CAPTION_COLOR = 35
    DWMWA_USE_IMMERSIVE_DARK_MODE = 20
    DWM_COLOR_NONE = 0xFFFFFFFE
    def _signed_lo(v):
        v = v & 0xFFFF
        return v - 0x10000 if v >= 0x8000 else v

    def _signed_hi(v):
        v = (v >> 16) & 0xFFFF
        return v - 0x10000 if v >= 0x8000 else v

    def _dbg_allow(hwnd, key, limit=16):
        if not _WIN_DEBUG:
            return False
        k = (int(hwnd or 0), str(key or ""))
        c = int(_WIN_DEBUG_COUNTERS.get(k, 0))
        if c >= int(limit):
            return False
        _WIN_DEBUG_COUNTERS[k] = c + 1
        return True

    def _dbg_print(msg):
        if not _WIN_DEBUG:
            return
        try:
            ts = time.strftime("%H:%M:%S")
            print(f"[wintitle-debug {ts}] {msg}")
        except Exception:
            pass

    def _cmd_log(msg):
        if not _UI_CMD_LOG:
            return
        try:
            ts = time.strftime("%H:%M:%S")
            print(f"[wintitle-cmd {ts}] {msg}")
        except Exception:
            pass

    def _trace_allow(hwnd, key, limit=200):
        if not _HITTEST_TRACE:
            return False
        k = (int(hwnd or 0), str(key or ""))
        c = int(_TRACE_COUNTERS.get(k, 0))
        if c >= int(limit):
            return False
        _TRACE_COUNTERS[k] = c + 1
        return True

    def _trace(msg):
        if not _HITTEST_TRACE:
            return
        try:
            ts = time.strftime("%H:%M:%S")
            print(f"[wintitle-trace {ts}] {msg}")
        except Exception:
            pass

    def _nav_log(msg):
        if not _NAV_TRACE:
            return
        try:
            ts = time.strftime("%H:%M:%S")
            print(f"[wintitle-nav {ts}] {msg}")
        except Exception:
            pass

    def _rect_tuple(rc):
        try:
            return (int(rc.left), int(rc.top), int(rc.right), int(rc.bottom), int(rc.right - rc.left), int(rc.bottom - rc.top))
        except Exception:
            return None

    def _get_rect(hwnd):
        r = wt.RECT()
        _GetWindowRect(hwnd, ctypes.byref(r))
        return r

    def _get_root_hwnd(hwnd):
        try:
            if not hwnd:
                return hwnd
            root = _GetAncestor(wt.HWND(hwnd), GA_ROOT)
            return int(root) if root else int(hwnd)
        except Exception:
            return int(hwnd) if hwnd else hwnd

    def _hwnd_class(hwnd):
        try:
            if not hwnd:
                return ""
            buf = ctypes.create_unicode_buffer(256)
            n = int(_GetClassNameW(wt.HWND(hwnd), buf, 255) or 0)
            return str(buf.value[:n] if n > 0 else buf.value)
        except Exception:
            return ""

    def _enum_child_hwnds(parent_hwnd):
        result = []

        @WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
        def _cb(h, _lp):
            try:
                result.append(int(h))
            except Exception:
                pass
            return True

        try:
            _EnumChildWindows(wt.HWND(parent_hwnd), _cb, 0)
        except Exception:
            pass
        return result

    def _looks_like_webview_child(hwnd):
        cls = (_hwnd_class(hwnd) or "").lower()
        # Temporary broad mode for diagnostics: if class exists, allow probing.
        return bool(cls)

    def _get_int_handle(obj):
        try:
            h = getattr(obj, "Handle", None)
            if not h:
                return None
            return int(h.ToInt64())
        except Exception:
            return None

    def _dump_form_handles(win):
        try:
            import webview.platforms.winforms as _wf
            form = _wf.BrowserView.instances.get(win.uid)
            if not form:
                _trace("dump handles: form not found")
                return []

            out = []
            fh = _get_int_handle(form)
            if fh:
                _trace(f"FORM hwnd={int(fh):#x} class={_hwnd_class(fh)}")
                out.append(int(fh))

            browser = getattr(form, "browser", None)
            if browser is not None:
                bh = _get_int_handle(browser)
                _trace(f"BROWSER type={type(browser)}")
                if bh:
                    _trace(f"BROWSER hwnd={int(bh):#x} class={_hwnd_class(bh)}")
                    out.append(int(bh))

            try:
                wv = getattr(browser, "webview", None) if browser is not None else None
                if wv is not None:
                    wh = _get_int_handle(wv)
                    _trace(f"WEBVIEW type={type(wv)}")
                    if wh:
                        _trace(f"WEBVIEW hwnd={int(wh):#x} class={_hwnd_class(wh)}")
                        out.append(int(wh))
            except Exception as e:
                _trace(f"WEBVIEW handle failed: {e}")
            return out
        except Exception as e:
            _trace(f"_dump_form_handles failed: {e}")
            return []

    def _hit_test_for_top_window(hwnd, lp, allow_caption=True):
        mx, my = _signed_lo(lp), _signed_hi(lp)
        rc = _get_rect(hwnd)
        x, y = mx - rc.left, my - rc.top
        w, hh = rc.right - rc.left, rc.bottom - rc.top

        fx, fy = _frame_insets()
        top_band = max(int(HITTEST_EDGE_BAND), int(fy) + 2)
        side_band = max(int(HITTEST_EDGE_BAND), int(fx) + 1)
        bottom_band = max(int(HITTEST_EDGE_BAND), int(fy) + 1)
        corner_band = max(int(HITTEST_CORNER_BAND), top_band, side_band, bottom_band)

        max_for_hit = bool(_is_maximized(hwnd))

        if _dbg_allow(hwnd, "hit_test_common", limit=30):
            _dbg_print(
                f"_hit_test_for_top_window screen=({mx},{my}) client=({x},{y}) "
                f"winWH=({w},{hh}) max={bool(max_for_hit)} "
                f"band(top={top_band},side={side_band},bottom={bottom_band},corner={corner_band})"
            )

        hit = None
        if not max_for_hit:
            if x <= corner_band and y <= corner_band:
                hit = HTTOPLEFT
            elif x >= w - corner_band and y <= corner_band:
                hit = HTTOPRIGHT
            elif x <= corner_band and y >= hh - corner_band:
                hit = HTBOTTOMLEFT
            elif x >= w - corner_band and y >= hh - corner_band:
                hit = HTBOTTOMRIGHT
            elif x <= side_band:
                hit = HTLEFT
            elif x >= w - side_band:
                hit = HTRIGHT
            elif y <= top_band:
                hit = HTTOP
            elif y >= hh - bottom_band:
                hit = HTBOTTOM

        if hit is None and allow_caption and y >= top_band and y < TITLEBAR_H and x < (w - BTN_AREA_W):
            hit = HTCAPTION

        if hit is not None and _trace_allow(hwnd, "hit_test_common_hit", limit=260):
            _trace(
                f"_hit_test_for_top_window hit={int(hit)} pos=({x},{y}) "
                f"winWH=({w},{hh}) max={bool(max_for_hit)}"
            )
        return hit

    def _make_child_wndproc(child_hwnd, parent_hwnd, old_ptr, _win):
        def _proc(h, msg, wp, lp):
            if msg == WM_NCHITTEST:
                if _trace_allow(child_hwnd, "child_nchittest_seen", limit=400):
                    _trace(
                        f"child WM_NCHITTEST seen hwnd={int(child_hwnd):#x} class={_hwnd_class(child_hwnd)}"
                    )
                hit = _hit_test_for_top_window(parent_hwnd, lp, allow_caption=True)
                if hit is not None:
                    if _trace_allow(child_hwnd, "child_nchittest_hit", limit=260):
                        _trace(
                            f"child WM_NCHITTEST hwnd={int(child_hwnd):#x} "
                            f"class={_hwnd_class(child_hwnd)} hit={int(hit)}"
                        )
                    return hit
                ret = _CallWindowProcW(old_ptr, h, msg, wp, lp)
                try:
                    if _is_maximized(parent_hwnd) and int(ret) in _RESIZE_HITS and _trace_allow(child_hwnd, "child_resize_hit_when_max", limit=400):
                        mx, my = _signed_lo(lp), _signed_hi(lp)
                        pr = _get_rect(parent_hwnd)
                        px, py = mx - pr.left, my - pr.top
                        pw, ph = pr.right - pr.left, pr.bottom - pr.top
                        _nav_log(
                            f"child_nchittest_resize ret={int(ret)} hwnd={int(child_hwnd):#x} class={_hwnd_class(child_hwnd)} "
                            f"pos=({px},{py}) winWH=({pw},{ph})"
                        )
                except Exception:
                    pass
                if _trace_allow(child_hwnd, "child_nchittest_passthrough", limit=200):
                    try:
                        mx, my = _signed_lo(lp), _signed_hi(lp)
                        pr = _get_rect(parent_hwnd)
                        x, y = mx - pr.left, my - pr.top
                        w, hh = pr.right - pr.left, pr.bottom - pr.top
                    except Exception:
                        x = y = w = hh = -1
                    _trace(
                        f"child WM_NCHITTEST passthrough hwnd={int(child_hwnd):#x} "
                        f"class={_hwnd_class(child_hwnd)} ret={int(ret)} pos=({x},{y}) winWH=({w},{hh})"
                    )
                return ret
            return _CallWindowProcW(old_ptr, h, msg, wp, lp)

        return _WndProcType(_proc)

    def _install_child_hit_test(win, parent_hwnd):
        try:
            children = _enum_child_hwnds(parent_hwnd)
            for h in _dump_form_handles(win):
                if h and h != int(parent_hwnd):
                    children.append(int(h))
            # Deduplicate while preserving order.
            uniq = []
            seen = set()
            for ch in children:
                k = int(ch)
                if k in seen:
                    continue
                seen.add(k)
                uniq.append(k)
            children = uniq
            if _trace_allow(parent_hwnd, "enum_children", limit=20):
                for ch in children:
                    _trace(f"child hwnd={int(ch):#x} class={_hwnd_class(ch)}")

            for ch in children:
                if ch in _CHILD_STATE:
                    continue
                if not _IsWindow(ch):
                    continue
                if not _looks_like_webview_child(ch):
                    continue

                old = _GetWindowLongPtrW(ch, GWLP_WNDPROC)
                if not old:
                    continue

                proc = _make_child_wndproc(ch, parent_hwnd, old, win)
                ptr = ctypes.cast(proc, ctypes.c_void_p).value
                _SetWindowLongPtrW(ch, GWLP_WNDPROC, ptr)
                _CHILD_STATE[ch] = {
                    "proc": proc,
                    "old": old,
                    "parent": parent_hwnd,
                }
                _trace(
                    f"child subclass installed hwnd={int(ch):#x} "
                    f"class={_hwnd_class(ch)} parent={int(parent_hwnd):#x}"
                )
        except Exception as e:
            _trace(f"_install_child_hit_test failed: {e}")

    def _retry_install_child_hit_test(win, parent_hwnd):
        def _worker():
            for _ in range(20):
                try:
                    _install_child_hit_test(win, parent_hwnd)
                except Exception:
                    pass
                time.sleep(0.2)

        threading.Thread(target=_worker, daemon=True).start()

    def _manual_max_active(hwnd):
        st = _MANUAL_MAX.get(hwnd)
        if not isinstance(st, dict):
            return False
        work = st.get("work")
        if not (isinstance(work, tuple) and len(work) == 4):
            _MANUAL_MAX.pop(hwnd, None)
            return False
        rc = _get_rect(hwnd)
        l, t, w, h = work
        cur = (rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top)
        if all(abs(int(cur[i]) - int(work[i])) <= 2 for i in range(4)):
            return True
        _MANUAL_MAX.pop(hwnd, None)
        return False

    def _is_maximized(hwnd):
        try:
            if bool(_IsZoomed(hwnd)):
                return True
        except Exception:
            pass
        try:
            wp = WINDOWPLACEMENT()
            wp.length = ctypes.sizeof(WINDOWPLACEMENT)
            if bool(_GetWindowPlacement(hwnd, ctypes.byref(wp))) and int(wp.showCmd) == int(SW_SHOWMAXIMIZED):
                return True
        except Exception:
            pass
        return _manual_max_active(hwnd)

    def _notify_js(win, hwnd):
        if bool(getattr(win, "_native_titlebar_host", False)):
            return
        m = _is_maximized(hwnd)
        if _dbg_allow(hwnd, "notify_js", limit=20):
            rc = _get_rect(hwnd)
            _dbg_print(f"notify_js max={bool(m)} rect={_rect_tuple(rc)}")
        try:
            win.evaluate_js(
                f"window._ncTitlebarSetMaximized&&window._ncTitlebarSetMaximized({'true' if m else 'false'});"
            )
        except Exception:
            pass

    def _get_monitor_info(hwnd):
        hmon = _MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
        if not hmon:
            return None
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        if not _GetMonitorInfoW(hmon, ctypes.byref(mi)):
            return None
        return mi

    def _get_monitor_work_area(hwnd):
        mi = _get_monitor_info(hwnd)
        if not mi:
            return None
        return mi.rcWork

    def _set_window_rect(hwnd, left, top, width, height):
        return bool(_SetWindowPos(
            hwnd,
            None,
            int(left),
            int(top),
            int(width),
            int(height),
            SWP_NOZORDER | SWP_NOACTIVATE,
        ))

    def _maximize_to_work_area(hwnd):
        wa = _get_monitor_work_area(hwnd)
        if not wa:
            return bool(_ShowWindow(hwnd, SW_SHOWMAXIMIZED))
        rc = _get_rect(hwnd)
        _MANUAL_MAX[hwnd] = {
            "restore": (rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top),
            "work": (wa.left, wa.top, wa.right - wa.left, wa.bottom - wa.top),
        }
        return _set_window_rect(hwnd, wa.left, wa.top, wa.right - wa.left, wa.bottom - wa.top)

    def _restore_from_manual_max(hwnd):
        st = _MANUAL_MAX.get(hwnd)
        if not isinstance(st, dict):
            return False
        restore = st.get("restore")
        _MANUAL_MAX.pop(hwnd, None)
        if not (isinstance(restore, tuple) and len(restore) == 4):
            return False
        return _set_window_rect(hwnd, restore[0], restore[1], restore[2], restore[3])

    def _snap_left(hwnd):
        wa = _get_monitor_work_area(hwnd)
        if not wa:
            return False
        w = max(320, int((wa.right - wa.left) / 2))
        h = max(240, int(wa.bottom - wa.top))
        return _set_window_rect(hwnd, wa.left, wa.top, w, h)

    def _snap_right(hwnd):
        wa = _get_monitor_work_area(hwnd)
        if not wa:
            return False
        half = max(320, int((wa.right - wa.left) / 2))
        h = max(240, int(wa.bottom - wa.top))
        left = int(wa.right - half)
        return _set_window_rect(hwnd, left, wa.top, half, h)

    def _apply_snap_from_rect(win, hwnd):
        if bool(_IsZoomed(hwnd)):
            return False
        wa = _get_monitor_work_area(hwnd)
        if not wa:
            return False
        rc = _get_rect(hwnd)

        if rc.top <= wa.top + SNAP_EDGE_THRESHOLD:
            _maximize_to_work_area(hwnd)
            _notify_js(win, hwnd)
            return True

        if rc.left <= wa.left + SNAP_EDGE_THRESHOLD:
            _MANUAL_MAX.pop(hwnd, None)
            ok = _snap_left(hwnd)
            _notify_js(win, hwnd)
            return ok

        if rc.right >= wa.right - SNAP_EDGE_THRESHOLD:
            _MANUAL_MAX.pop(hwnd, None)
            ok = _snap_right(hwnd)
            _notify_js(win, hwnd)
            return ok

        _MANUAL_MAX.pop(hwnd, None)
        return False

    def _find_hwnd(win):
        try:
            import webview.platforms.winforms as _wf
            form = _wf.BrowserView.instances.get(win.uid)
            if form and form.Handle:
                h = int(form.Handle.ToInt64())
                return _get_root_hwnd(h)
        except Exception:
            pass

        fw = windll.user32.FindWindowW
        fw.restype = wt.HWND
        h = fw(None, win.title)
        if h:
            return _get_root_hwnd(h)

        result = []

        @WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
        def _cb(h_, _):
            buf = ctypes.create_unicode_buffer(512)
            windll.user32.GetWindowTextW(h_, buf, 512)
            if buf.value == win.title:
                result.append(h_)
            return True

        windll.user32.EnumWindows(_cb, 0)
        return _get_root_hwnd(result[0]) if result else None

    def _resolve(win):
        c = _WIN_HWND.get(id(win))
        if c and _IsWindow(c):
            return c
        h = _find_hwnd(win)
        if h:
            _WIN_HWND[id(win)] = h
        return h

    def _emulate_snap_enabled(hwnd):
        st = _STATE.get(hwnd)
        if isinstance(st, dict):
            return bool(st.get("emulate_snap", True))
        return True

    def _custom_chrome_enabled(hwnd):
        return hwnd in _CUSTOM_CHROME

    def _frame_insets():
        fx = int(_GetSystemMetrics(SM_CXFRAME) or 0)
        fy = int(_GetSystemMetrics(SM_CYFRAME) or 0)
        pad = int(_GetSystemMetrics(SM_CXPADDEDBORDER) or 0)
        return max(0, fx + pad), max(0, fy + pad)

    def _syscommand_on_ui_thread(win, command):
        hwnd = _resolve(win)
        if not hwnd:
            return False
        cmd = int(command)
        t0 = time.perf_counter()

        def _cursor_lparam():
            try:
                pt = wt.POINT()
                if not _GetCursorPos(ctypes.byref(pt)):
                    return 0
                x = int(pt.x) & 0xFFFF
                y = int(pt.y) & 0xFFFF
                return (y << 16) | x
            except Exception:
                return 0

        lp = _cursor_lparam()
        try:
            import webview.platforms.winforms as _wf
            from System import Action

            form = _wf.BrowserView.instances.get(win.uid)
            if form:
                def _do():
                    # Use synchronous syscommand on UI thread to better match
                    # native caption button behavior and DWM transition timing.
                    try:
                        _SetForegroundWindow(hwnd)
                    except Exception:
                        pass
                    _SendMessageW(hwnd, WM_SYSCOMMAND, cmd, lp)
                if bool(getattr(form, "InvokeRequired", False)):
                    form.Invoke(Action(_do))
                else:
                    _do()
                _cmd_log(f"syscommand ui-thread cmd=0x{cmd:x} took={(time.perf_counter()-t0)*1000:.2f}ms")
                return True
        except Exception:
            pass
        try:
            try:
                _SetForegroundWindow(hwnd)
            except Exception:
                pass
            _SendMessageW(hwnd, WM_SYSCOMMAND, cmd, lp)
            _cmd_log(f"syscommand fallback cmd=0x{cmd:x} took={(time.perf_counter()-t0)*1000:.2f}ms")
            return True
        except Exception:
            try:
                return bool(_PostMessageW(hwnd, WM_SYSCOMMAND, cmd, lp))
            except Exception:
                return False

    def _tune_custom_chrome_visuals(hwnd):
        if _DwmSetWindowAttribute is None:
            return
        try:
            dark = wt.BOOL(1)
            _DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ctypes.byref(dark), ctypes.sizeof(dark))
        except Exception:
            pass
        try:
            none_color = wt.DWORD(DWM_COLOR_NONE)
            _DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ctypes.byref(none_color), ctypes.sizeof(none_color))
        except Exception:
            pass
        try:
            caption_color = wt.DWORD(0x00050505)
            _DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, ctypes.byref(caption_color), ctypes.sizeof(caption_color))
        except Exception:
            pass

    def enable_custom_chrome(win):
        """
        Keep native overlapped window semantics (including WS_CAPTION)
        for system transition behavior, and hide the visual caption via
        WM_NCCALCSIZE in subclassed WndProc.
        """
        hwnd = _resolve(win)
        if not hwnd:
            return False
        try:
            style = _GetWindowLongPtrW(hwnd, GWL_STYLE)
            # Preserve standard overlapped behavior to avoid transition glitches.
            style = int(style) | WS_CAPTION | WS_BORDER | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU
            _SetWindowLongPtrW(hwnd, GWL_STYLE, style)
            _SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            )
            _tune_custom_chrome_visuals(hwnd)
            _CUSTOM_CHROME.add(hwnd)
            return True
        except Exception:
            return False

    def ensure_resizable_frame(win):
        """Re-assert resizable overlapped frame bits without changing visual mode."""
        hwnd = _resolve(win)
        if not hwnd:
            return False
        try:
            style = _GetWindowLongPtrW(hwnd, GWL_STYLE)
            style = int(style) | WS_THICKFRAME | WS_SIZEBOX | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU
            _SetWindowLongPtrW(hwnd, GWL_STYLE, style)
            _SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            )
            return True
        except Exception:
            return False

    def enforce_borderless_chrome(win):
        """Hard-remove native border/caption bits to keep frameless visual stable."""
        hwnd = _resolve(win)
        if not hwnd:
            return False
        try:
            style = int(_GetWindowLongPtrW(hwnd, GWL_STYLE))
            style &= ~(WS_CAPTION | WS_BORDER | WS_THICKFRAME)
            style |= (WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU)
            _SetWindowLongPtrW(hwnd, GWL_STYLE, style)
            _SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            )
            return True
        except Exception:
            return False

    def force_frame_refresh(win):
        hwnd = _resolve(win)
        if not hwnd:
            return False
        try:
            _SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            )
            return True
        except Exception:
            return False

    def _make_wndproc(hwnd, old_ptr, win, emulate_snap=True):
        def _call_old_safe(h, msg, wp, lp):
            try:
                return _CallWindowProcW(old_ptr, h, msg, wp, lp)
            except OSError as e:
                try:
                    _trace(
                        f"CallWindowProcW failed hwnd={int(hwnd):#x} msg={int(msg)} "
                        f"wp={int(wp)} lp={int(lp)} err={e}"
                    )
                except Exception:
                    pass
                return 0

        def _proc(h, msg, wp, lp):
            is_custom = _custom_chrome_enabled(hwnd)

            if is_custom and msg == WM_NCCALCSIZE:
                # Only handle NCCALCSIZE in the "calc valid rects" phase.
                # Returning 0 on the non-calc phase can cause first-frame
                # offset/jump on some WebView2 + DWM combinations.
                if not wp:
                    return _call_old_safe(h, msg, wp, lp)
                if _dbg_allow(hwnd, "nccalc_enter", limit=32):
                    rc0 = None
                    try:
                        p0 = ctypes.cast(lp, ctypes.POINTER(NCCALCSIZE_PARAMS)).contents
                        rc0 = _rect_tuple(p0.rgrc[0])
                    except Exception:
                        rc0 = None
                    _dbg_print(
                        f"WM_NCCALCSIZE enter custom=1 max={bool(_is_maximized(hwnd))} wp={int(wp)} rc0={rc0} frameInsets={_frame_insets()}"
                    )
                # In maximized state, inset by full frame metrics to avoid clipping.
                if _is_maximized(hwnd):
                    try:
                        p = ctypes.cast(lp, ctypes.POINTER(NCCALCSIZE_PARAMS)).contents
                        fx, fy = _frame_insets()
                        p.rgrc[0].left += int(max(0, fx))
                        p.rgrc[0].right -= int(max(0, fx))
                        p.rgrc[0].bottom -= int(max(0, fy))
                        # In maximized custom mode, reserve the full top frame inset.
                        # This avoids obvious top clipping of web titlebar icons at high DPI.
                        p.rgrc[0].top += int(max(0, fy))
                    except Exception:
                        pass
                else:
                    if _trace_allow(hwnd, "nccalc_normal_inset", limit=40):
                        _trace("WM_NCCALCSIZE normal inset=0 (full client; child hit-test handles resize)")
                if _dbg_allow(hwnd, "nccalc_exit", limit=32):
                    rc1 = None
                    try:
                        p1 = ctypes.cast(lp, ctypes.POINTER(NCCALCSIZE_PARAMS)).contents
                        rc1 = _rect_tuple(p1.rgrc[0])
                    except Exception:
                        rc1 = None
                    _dbg_print(f"WM_NCCALCSIZE exit rc0={rc1}")
                return 0

            if is_custom and msg == WM_GETMINMAXINFO and lp:
                try:
                    mi = _get_monitor_info(hwnd)
                    if mi:
                        mmi = ctypes.cast(lp, ctypes.POINTER(MINMAXINFO)).contents
                        mmi.ptMaxPosition.x = int(mi.rcWork.left - mi.rcMonitor.left)
                        mmi.ptMaxPosition.y = int(mi.rcWork.top - mi.rcMonitor.top)
                        mmi.ptMaxSize.x = int(mi.rcWork.right - mi.rcWork.left)
                        mmi.ptMaxSize.y = int(mi.rcWork.bottom - mi.rcWork.top)
                    return 0
                except Exception:
                    pass

            if msg == WM_NCHITTEST:
                hit = _hit_test_for_top_window(hwnd, lp, allow_caption=True)
                if hit is not None:
                    return hit

                ret = _call_old_safe(h, msg, wp, lp)
                try:
                    if _is_maximized(hwnd) and int(ret) in _RESIZE_HITS and _trace_allow(hwnd, "top_resize_hit_when_max", limit=400):
                        mx, my = _signed_lo(lp), _signed_hi(lp)
                        rc = _get_rect(hwnd)
                        x, y = mx - rc.left, my - rc.top
                        w, hh = rc.right - rc.left, rc.bottom - rc.top
                        _nav_log(f"top_nchittest_resize ret={int(ret)} pos=({x},{y}) winWH=({w},{hh})")
                except Exception:
                    pass
                if _trace_allow(hwnd, "nchittest_passthrough", limit=160):
                    mx, my = _signed_lo(lp), _signed_hi(lp)
                    rc = _get_rect(hwnd)
                    x, y = mx - rc.left, my - rc.top
                    w, hh = rc.right - rc.left, rc.bottom - rc.top
                    _trace(
                        f"WM_NCHITTEST passthrough ret={int(ret)} pos=({x},{y}) winWH=({w},{hh}) custom={bool(is_custom)}"
                    )
                return ret

            if msg == WM_SETCURSOR:
                hit = 0
                try:
                    if _is_maximized(hwnd):
                        hit = int(lp) & 0xFFFF
                        if hit in _RESIZE_HITS and _trace_allow(hwnd, "setcursor_resize_when_max", limit=400):
                            _nav_log(f"setcursor_resize hit={int(hit)} wp={int(wp)} lp={int(lp)}")
                except Exception:
                    pass

            if msg == WM_NCLBUTTONDBLCLK and int(wp) == HTCAPTION:
                # Ensure custom frameless maximize/restore also works on native
                # non-client double-click.
                if _emulate_snap_enabled(hwnd):
                    if _restore_from_manual_max(hwnd):
                        _notify_js(win, hwnd)
                        return 0
                    _maximize_to_work_area(hwnd)
                    _notify_js(win, hwnd)

                def _borderless_mode_enabled(hwnd):
                    try:
                        st = _STATE.get(hwnd) or {}
                        return bool(st.get("borderless_mode", False))
                    except Exception:
                        return False
                    return 0
                try:
                    if bool(_IsZoomed(hwnd)):
                        _syscommand_on_ui_thread(win, SC_RESTORE)
                    else:
                        _syscommand_on_ui_thread(win, SC_MAXIMIZE)
                except Exception:
                    try:
                        toggle_max_restore(win)
                    except Exception:
                        pass
                _notify_js(win, hwnd)
                return 0

            if msg == WM_SIZE:
                if _dbg_allow(hwnd, "wmsize", limit=40):
                    rc = _get_rect(hwnd)
                    _dbg_print(f"WM_SIZE wp={int(wp)} lp={int(lp)} rect={_rect_tuple(rc)}")
                threading.Thread(target=_notify_js, args=(win, hwnd), daemon=True).start()

            if msg == WM_EXITSIZEMOVE:
                if _dbg_allow(hwnd, "exit_size_move", limit=40):
                    rc = _get_rect(hwnd)
                    _dbg_print(f"WM_EXITSIZEMOVE rect_before={_rect_tuple(rc)} emulate_snap={bool(emulate_snap)}")
                try:
                    style = _GetWindowLongPtrW(hwnd, GWL_STYLE)
                    # Keep style consistent with window mode, independent from
                    # snap emulation strategy (native/manual).
                    if _borderless_mode_enabled(hwnd):
                        style = (int(style) | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU) & ~(WS_CAPTION | WS_BORDER | WS_THICKFRAME | WS_SIZEBOX)
                    else:
                        style = int(style) | WS_THICKFRAME | WS_SIZEBOX | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU
                    _SetWindowLongPtrW(hwnd, GWL_STYLE, style)
                    _SetWindowPos(
                        hwnd,
                        None,
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                    )
                except Exception:
                    pass
                if emulate_snap:
                    threading.Thread(target=_apply_snap_from_rect, args=(win, hwnd), daemon=True).start()

            return _call_old_safe(h, msg, wp, lp)

        return _WndProcType(_proc)

    def install(win, emulate_snap=True, borderless_mode=False):
        """Subclass the top-level Form HWND (called from on_shown)."""

        def _attach():
            try:
                _trace(f"install begin win_id={id(win)} emulate_snap={bool(emulate_snap)}")
                hwnd = None
                for idx in range(180):
                    hwnd = _find_hwnd(win)
                    if hwnd:
                        break
                    if idx in {0, 20, 60, 120, 179}:
                        _trace(f"install waiting hwnd idx={idx} win_id={id(win)}")
                    time.sleep(0.03)
                if not hwnd:
                    print("[wintitle] HWND not found")
                    _trace(f"install failed no hwnd win_id={id(win)}")
                    return
                if hwnd in _STATE:
                    _trace(f"install skip already-hooked hwnd={int(hwnd):#x}")
                    return
                _trace(
                    f"install target hwnd={int(hwnd):#x} class={_hwnd_class(hwnd) or '<unknown>'}"
                )
                old = _GetWindowLongPtrW(hwnd, GWLP_WNDPROC)
                if not old:
                    print(f"[wintitle] invalid old WndProc HWND={hwnd:#x}")
                    _trace(f"install failed invalid old wndproc hwnd={int(hwnd):#x}")
                    return
                proc = _make_wndproc(
                    hwnd,
                    old,
                    win,
                    emulate_snap=bool(emulate_snap),
                )
                ptr = ctypes.cast(proc, ctypes.c_void_p).value
                _SetWindowLongPtrW(hwnd, GWLP_WNDPROC, ptr)
                _STATE[hwnd] = {
                    "proc": proc,
                    "old": old,
                    "emulate_snap": bool(emulate_snap),
                    "borderless_mode": bool(borderless_mode),
                }
                _WIN_HWND[id(win)] = hwnd
                _install_child_hit_test(win, hwnd)
                _retry_install_child_hit_test(win, hwnd)
                # Force a non-client frame recalculation immediately after subclassing.
                _SetWindowPos(
                    hwnd,
                    None,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                )
                if _WIN_DEBUG:
                    rc = _get_rect(hwnd)
                    _dbg_print(f"install hwnd={int(hwnd):#x} emulate_snap={bool(emulate_snap)} rect={_rect_tuple(rc)}")
                print(f"[wintitle] WndProc installed HWND={hwnd:#x}")
                _trace(f"install ok hwnd={int(hwnd):#x} emulate_snap={bool(emulate_snap)}")
            except Exception as e:
                print(f"[wintitle] install failed: {e}")
                _trace(f"install exception: {e}")

        threading.Thread(target=_attach, daemon=True).start()

    def toggle_max_restore(win):
        hwnd = _resolve(win)
        if not hwnd:
            return False
        before = bool(_is_maximized(hwnd))
        if not _emulate_snap_enabled(hwnd):
            if before:
                _syscommand_on_ui_thread(win, SC_RESTORE)
            else:
                _syscommand_on_ui_thread(win, SC_MAXIMIZE)
            try:
                time.sleep(0.02)
            except Exception:
                pass
            after = bool(_is_maximized(hwnd))
            if after == before:
                try:
                    _ShowWindow(hwnd, SW_RESTORE if before else SW_SHOWMAXIMIZED)
                except Exception:
                    pass
            threading.Thread(target=_notify_js, args=(win, hwnd), daemon=True).start()
            return True
        if _restore_from_manual_max(hwnd):
            threading.Thread(target=_notify_js, args=(win, hwnd), daemon=True).start()
            return True
        if before:
            _ShowWindow(hwnd, SW_RESTORE)
        else:
            _maximize_to_work_area(hwnd)
        threading.Thread(target=_notify_js, args=(win, hwnd), daemon=True).start()
        return True

    def minimize_window(win):
        hwnd = _resolve(win)
        if not hwnd:
            return False
        try:
            _syscommand_on_ui_thread(win, SC_MINIMIZE)
            _notify_js(win, hwnd)
            return True
        except Exception:
            return False

    def start_window_resize(win, edge="right"):
        hwnd = _resolve(win)
        if not hwnd:
            return False
        try:
            if _is_maximized(hwnd):
                _nav_log(f"resize_blocked_when_maximized edge={str(edge or '').strip().lower()}")
                return False
        except Exception:
            pass
        mapping = {
            "left": 1,
            "right": 2,
            "top": 3,
            "top-left": 4,
            "top-right": 5,
            "bottom": 6,
            "bottom-left": 7,
            "bottom-right": 8,
        }
        key = str(edge or "").strip().lower()
        code = int(mapping.get(key, 2))

        def _cursor_lparam():
            try:
                pt = wt.POINT()
                if not _GetCursorPos(ctypes.byref(pt)):
                    return 0
                x = int(pt.x) & 0xFFFF
                y = int(pt.y) & 0xFFFF
                return (y << 16) | x
            except Exception:
                return 0

        wp = int(SC_SIZE | code)
        lp = _cursor_lparam()

        if _dbg_allow(hwnd, "start_resize", limit=60):
            rc = _get_rect(hwnd)
            _dbg_print(f"start_window_resize edge={key} code={code} wp={wp:#x} lp={lp:#x} rect={_rect_tuple(rc)}")

        def _do_resize():
            try:
                _SetForegroundWindow(hwnd)
            except Exception:
                pass
            try:
                _ReleaseCapture()
            except Exception:
                pass
            _SendMessageW(hwnd, WM_SYSCOMMAND, wp, lp)

        try:
            import webview.platforms.winforms as _wf
            from System import Action

            form = _wf.BrowserView.instances.get(win.uid)
            if form:
                if bool(getattr(form, "InvokeRequired", False)):
                    form.Invoke(Action(_do_resize))
                else:
                    _do_resize()
                return True
        except Exception:
            pass

        try:
            _do_resize()
            if _dbg_allow(hwnd, "start_resize_done", limit=60):
                rc2 = _get_rect(hwnd)
                _dbg_print(f"start_window_resize done edge={key} rect={_rect_tuple(rc2)}")
            return True
        except Exception:
            return False

    def titlebar_double_click(win):
        hwnd = _resolve(win)
        if not hwnd:
            return False

        def _do_dbl():
            try:
                _SetForegroundWindow(hwnd)
            except Exception:
                pass
            try:
                _ReleaseCapture()
            except Exception:
                pass
            _SendMessageW(hwnd, WM_NCLBUTTONDBLCLK, HTCAPTION, 0)

        try:
            import webview.platforms.winforms as _wf
            from System import Action

            form = _wf.BrowserView.instances.get(win.uid)
            if form:
                if bool(getattr(form, "InvokeRequired", False)):
                    form.Invoke(Action(_do_dbl))
                else:
                    _do_dbl()
                return True
        except Exception:
            pass

        try:
            _do_dbl()
            return True
        except Exception:
            return False

    def nudge_window_size(win):
        hwnd = _resolve(win)
        if not hwnd:
            return False
        try:
            if _is_maximized(hwnd):
                return False
        except Exception:
            pass
        try:
            rc = _get_rect(hwnd)
            w = max(320, int(rc.right - rc.left))
            h = max(240, int(rc.bottom - rc.top))
            l = int(rc.left)
            t = int(rc.top)
            if _dbg_allow(hwnd, "nudge", limit=20):
                _dbg_print(f"nudge_window_size before rect={_rect_tuple(rc)}")
            _SetWindowPos(hwnd, None, l, t, w + 1, h, SWP_NOZORDER | SWP_NOACTIVATE)
            _SetWindowPos(hwnd, None, l, t, w, h, SWP_NOZORDER | SWP_NOACTIVATE)
            if _dbg_allow(hwnd, "nudge_done", limit=20):
                rc2 = _get_rect(hwnd)
                _dbg_print(f"nudge_window_size after rect={_rect_tuple(rc2)}")
            return True
        except Exception:
            return False

    def start_window_drag(win):
        """Start a native title-bar drag. Must run on the UI thread."""
        hwnd = _resolve(win)
        if not hwnd:
            return False
        try:
            import webview.platforms.winforms as _wf
            from System import Func, Type as _T

            form = _wf.BrowserView.instances.get(win.uid)
            if form:
                def _do():
                    _ReleaseCapture()
                    _SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0)

                form.BeginInvoke(Func[_T](_do))
                return True
        except Exception:
            pass

        _ReleaseCapture()
        _SendMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0)
        return True

    def sync_max_state(win):
        hwnd = _resolve(win)
        if not hwnd:
            return False
        _notify_js(win, hwnd)
        return True

    def is_window_maximized(win):
        hwnd = _resolve(win)
        if not hwnd:
            return False
        return bool(_is_maximized(hwnd))

    def snap_window(win, mode="max", screen_x=None, screen_y=None):
        """Manual snap fallback: mode=max|restore|left|right."""
        hwnd = _resolve(win)
        if not hwnd:
            return False
        if not _emulate_snap_enabled(hwnd):
            m = str(mode or "").strip().lower()
            if m == "restore":
                _syscommand_on_ui_thread(win, SC_RESTORE)
                _notify_js(win, hwnd)
                return True
            if m == "left":
                ok = _snap_left(hwnd)
                _notify_js(win, hwnd)
                return ok
            if m == "right":
                ok = _snap_right(hwnd)
                _notify_js(win, hwnd)
                return ok
            _syscommand_on_ui_thread(win, SC_MAXIMIZE)
            _notify_js(win, hwnd)
            return True
        m = str(mode or "").strip().lower()
        if m == "restore":
            if not _restore_from_manual_max(hwnd):
                _ShowWindow(hwnd, SW_RESTORE)
            _notify_js(win, hwnd)
            return True
        if m == "left":
            _MANUAL_MAX.pop(hwnd, None)
            ok = _snap_left(hwnd)
            _notify_js(win, hwnd)
            return ok
        if m == "right":
            _MANUAL_MAX.pop(hwnd, None)
            ok = _snap_right(hwnd)
            _notify_js(win, hwnd)
            return ok
        _maximize_to_work_area(hwnd)
        _notify_js(win, hwnd)
        return True

    def set_window_topmost(win, enabled=True):
        hwnd = _resolve(win)
        if not hwnd:
            return False
        try:
            insert_after = HWND_TOPMOST if bool(enabled) else HWND_NOTOPMOST
            return bool(_SetWindowPos(
                hwnd,
                insert_after,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
            ))
        except Exception:
            return False

    def add_startup_script(win, script):
        """
        Add script to execute before each document is created.
        This removes the titlebar "missing during load" gap.
        """
        src = str(script or "")
        if not src.strip():
            return False

        for _ in range(60):
            try:
                import webview.platforms.winforms as _wf
                from System import Func, Type as _T

                form = _wf.BrowserView.instances.get(win.uid)
                if not form or not form.browser:
                    time.sleep(0.08)
                    continue

                ok = [False]

                def _set():
                    try:
                        core = form.browser.webview.CoreWebView2
                        if core:
                            core.AddScriptToExecuteOnDocumentCreated(src)
                            ok[0] = True
                    except Exception:
                        pass

                form.Invoke(Func[_T](_set))
                if ok[0]:
                    return True
            except Exception:
                pass
            time.sleep(0.08)
        return False

    def set_webview_dark_background(win, r=5, g=5, b=5):
        """
        Force WebView2 host/background color at native layer to avoid white flash
        while navigating between documents.
        """
        rr = max(0, min(255, int(r)))
        gg = max(0, min(255, int(g)))
        bb = max(0, min(255, int(b)))

        for _ in range(80):
            try:
                import webview.platforms.winforms as _wf
                from System import Action
                from System.Drawing import Color

                form = _wf.BrowserView.instances.get(win.uid)
                if not form or not getattr(form, "browser", None):
                    time.sleep(0.08)
                    continue

                ok = [False]

                def _apply():
                    try:
                        c = Color.FromArgb(255, rr, gg, bb)
                        try:
                            form.BackColor = c
                        except Exception:
                            pass

                        browser = getattr(form, "browser", None)
                        if browser is not None:
                            try:
                                browser.BackColor = c
                            except Exception:
                                pass

                            wv = getattr(browser, "webview", None)
                            if wv is not None:
                                try:
                                    wv.DefaultBackgroundColor = c
                                except Exception:
                                    pass
                                try:
                                    ctl = getattr(wv, "CoreWebView2Controller", None)
                                    if ctl is not None:
                                        ctl.DefaultBackgroundColor = c
                                except Exception:
                                    pass
                        ok[0] = True
                    except Exception:
                        pass

                if bool(getattr(form, "InvokeRequired", False)):
                    form.Invoke(Action(_apply))
                else:
                    _apply()

                if ok[0]:
                    return True
            except Exception:
                pass
            time.sleep(0.08)
        return False

    def install_navigation_cover(win, top_offset=36, r=5, g=5, b=5, hide_delay_ms=220):
        """
        Install a native overlay form (owned by main form) that stays above WebView
        during navigation transitions. This avoids white flashes even when WebView
        child HWND draws above in-form controls.
        """
        rr = max(0, min(255, int(r)))
        gg = max(0, min(255, int(g)))
        bb = max(0, min(255, int(b)))
        top = max(0, int(top_offset or 0))
        delay_ms = max(0, int(hide_delay_ms or 0))

        for _ in range(80):
            try:
                import webview.platforms.winforms as _wf
                from System import Action
                from System.Drawing import Color, Font, Point, Size
                from System.Windows.Forms import ContentAlignment, Form, FormBorderStyle, Label, FormStartPosition

                form = _wf.BrowserView.instances.get(win.uid)
                if not form or not getattr(form, "browser", None):
                    time.sleep(0.08)
                    continue

                ok = [False]

                def _install():
                    try:
                        key = id(win)
                        if key in _NAV_COVER_STATE:
                            _nav_log("nav_cover already installed")
                            ok[0] = True
                            return

                        cover = Form()
                        cover.Name = "ncNativeNavCover"
                        cover.FormBorderStyle = getattr(FormBorderStyle, "None")
                        cover.StartPosition = FormStartPosition.Manual
                        cover.ShowInTaskbar = False
                        cover.TopMost = True
                        cover.BackColor = Color.FromArgb(255, rr, gg, bb)
                        cover.MinimizeBox = False
                        cover.MaximizeBox = False
                        cover.ControlBox = False
                        cover.Text = ""
                        cover.Visible = False

                        label = Label()
                        label.Text = "Loading Nexora..."
                        label.ForeColor = Color.FromArgb(220, 220, 220)
                        label.BackColor = Color.Transparent
                        try:
                            label.Font = Font("Segoe UI", 9.0)
                        except Exception:
                            pass
                        label.TextAlign = ContentAlignment.MiddleCenter
                        label.Dock = 5  # Fill
                        label.TabStop = False
                        cover.Controls.Add(label)

                        def _layout(_s=None, _e=None):
                            try:
                                cw = int(form.ClientSize.Width or 0)
                                ch = int(form.ClientSize.Height or 0)
                                h = max(0, ch - top)
                                pt = form.PointToScreen(Point(0, top))
                                cover.Location = pt
                                cover.Size = Size(max(0, cw), h)
                                try:
                                    cover.BringToFront()
                                except Exception:
                                    pass
                            except Exception:
                                pass

                        def _invoke_form(action):
                            try:
                                if bool(getattr(form, "InvokeRequired", False)):
                                    form.Invoke(Action(action))
                                else:
                                    action()
                            except Exception:
                                pass

                        state = {"hold_until_loaded": False}

                        def _show_cover(_s=None, _e=None):
                            def _do_show():
                                try:
                                    _layout()
                                    if not bool(getattr(cover, "Visible", False)):
                                        try:
                                            cover.Show(form)
                                        except Exception:
                                            cover.Show()
                                    cover.Visible = True
                                    cover.BringToFront()
                                    _nav_log("nav_cover show")
                                except Exception:
                                    pass
                            _invoke_form(_do_show)

                        def _hide_cover(_s=None, _e=None):
                            def _do_hide():
                                try:
                                    cover.Visible = False
                                    _nav_log("nav_cover hide")
                                except Exception:
                                    pass

                            try:
                                if delay_ms <= 0:
                                    _do_hide()
                                    return

                                def _timer_hide():
                                    _invoke_form(_do_hide)

                                threading.Timer(delay_ms / 1000.0, _timer_hide).start()
                            except Exception:
                                _do_hide()

                        try:
                            form.AddOwnedForm(cover)
                        except Exception:
                            pass
                        _layout()

                        try:
                            form.Move += _layout
                        except Exception:
                            pass
                        try:
                            form.Resize += _layout
                        except Exception:
                            pass
                        try:
                            form.VisibleChanged += _layout
                        except Exception:
                            pass

                        core_ref = {"core": None}

                        def _bind_core():
                            for _ in range(120):
                                try:
                                    core = form.browser.webview.CoreWebView2
                                except Exception:
                                    core = None
                                if core is not None:
                                    _nav_log("CoreWebView2 ready, bind nav events")
                                    def _on_nav_start(sender, args):
                                        try:
                                            uri = str(getattr(args, "Uri", "") or "")
                                        except Exception:
                                            uri = ""
                                        state["hold_until_loaded"] = True
                                        _nav_log(f"NavigationStarting uri={uri}")
                                        _show_cover(sender, args)

                                    def _on_nav_done(sender, args):
                                        try:
                                            ok_flag = bool(getattr(args, "IsSuccess", False))
                                        except Exception:
                                            ok_flag = False
                                        try:
                                            code = str(getattr(args, "WebErrorStatus", "") or "")
                                        except Exception:
                                            code = ""
                                        _nav_log(f"NavigationCompleted ok={ok_flag} err={code}")
                                        if state.get("hold_until_loaded"):
                                            _nav_log("nav_cover hold_until_loaded=true, wait for loaded callback")
                                            return
                                        _hide_cover(sender, args)

                                    try:
                                        core.NavigationStarting += _on_nav_start
                                    except Exception:
                                        pass
                                    try:
                                        core.NavigationCompleted += _on_nav_done
                                    except Exception:
                                        pass
                                    core_ref["core"] = core
                                    core_ref["on_nav_start"] = _on_nav_start
                                    core_ref["on_nav_done"] = _on_nav_done
                                    return
                                time.sleep(0.1)
                            _nav_log("CoreWebView2 bind timeout")

                        threading.Thread(target=_bind_core, daemon=True).start()

                        _NAV_COVER_STATE[key] = {
                            "cover": cover,
                            "label": label,
                            "invoke_form": _invoke_form,
                            "form_move": _layout,
                            "form_resize": _layout,
                            "form_visible": _layout,
                            "nav_start": _show_cover,
                            "nav_done": _hide_cover,
                            "state": state,
                            "core_ref": core_ref,
                        }
                        _nav_log("nav_cover installed")
                        ok[0] = True
                    except Exception:
                        pass

                if bool(getattr(form, "InvokeRequired", False)):
                    form.Invoke(Action(_install))
                else:
                    _install()

                if ok[0]:
                    return True
            except Exception:
                pass
            time.sleep(0.08)
        return False

    def release_navigation_cover(win, hide=True):
        key = id(win)
        data = _NAV_COVER_STATE.get(key)
        if not data:
            _nav_log("release_navigation_cover: no state")
            return False
        try:
            st = data.get("state")
            if isinstance(st, dict):
                st["hold_until_loaded"] = False
            _nav_log(f"release_navigation_cover: hide={bool(hide)}")
            if bool(hide):
                fn = data.get("nav_done")
                if callable(fn):
                    fn()
            return True
        except Exception:
            return False

    def enable_app_region(win):
        """
        Enable WebView2 built-in -webkit-app-region CSS support.
        Retries until CoreWebView2 is initialised (up to ~5 s).
        """

        def _try():
            for _ in range(50):
                try:
                    import webview.platforms.winforms as _wf
                    from System import Func, Type as _T

                    form = _wf.BrowserView.instances.get(win.uid)
                    if not form or not form.browser:
                        time.sleep(0.1)
                        continue
                    ok = [False]

                    def _set():
                        try:
                            core = form.browser.webview.CoreWebView2
                            if core and hasattr(core.Settings, "IsNonClientRegionSupportEnabled"):
                                core.Settings.IsNonClientRegionSupportEnabled = True
                                ok[0] = True
                        except Exception:
                            pass

                    form.Invoke(Func[_T](_set))
                    if ok[0]:
                        print("[wintitle] app-region drag enabled")
                        return
                except Exception:
                    pass
                time.sleep(0.1)
            print("[wintitle] app-region not available (older WebView2?)")

        threading.Thread(target=_try, daemon=True).start()
