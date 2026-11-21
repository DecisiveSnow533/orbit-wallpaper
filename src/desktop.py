"""Aggancio di una finestra al desktop di Windows (sfondo animato dietro alle icone)."""
import ctypes
import time
from ctypes import wintypes

u = ctypes.windll.user32
k32 = ctypes.windll.kernel32

try:  # coordinate in pixel fisici
    u.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
except Exception:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        pass

HWND = ctypes.c_void_p
u.FindWindowW.restype = HWND
u.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
u.FindWindowExW.restype = HWND
u.FindWindowExW.argtypes = [HWND, HWND, wintypes.LPCWSTR, wintypes.LPCWSTR]
u.GetParent.restype = HWND
u.GetParent.argtypes = [HWND]
u.SetParent.restype = HWND
u.SetParent.argtypes = [HWND, HWND]
u.GetWindow.restype = HWND
u.GetWindow.argtypes = [HWND, wintypes.UINT]
u.IsWindow.argtypes = [HWND]
u.IsWindowVisible.argtypes = [HWND]
u.IsIconic.argtypes = [HWND]
u.IsZoomed.argtypes = [HWND]
u.GetClassNameW.argtypes = [HWND, wintypes.LPWSTR, ctypes.c_int]
u.GetWindowTextW.argtypes = [HWND, wintypes.LPWSTR, ctypes.c_int]
u.GetWindowRect.argtypes = [HWND, ctypes.POINTER(wintypes.RECT)]
u.GetWindowThreadProcessId.argtypes = [HWND, ctypes.POINTER(wintypes.DWORD)]
u.GetForegroundWindow.restype = HWND
u.SetWindowPos.argtypes = [HWND, HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
u.ScreenToClient.argtypes = [HWND, ctypes.POINTER(wintypes.POINT)]
u.SendMessageTimeoutW.argtypes = [HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM, wintypes.UINT, wintypes.UINT, ctypes.POINTER(ctypes.c_size_t)]
u.MonitorFromWindow.restype = ctypes.c_void_p
u.MonitorFromWindow.argtypes = [HWND, wintypes.DWORD]
u.GetMonitorInfoW.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
u.ShowWindow.argtypes = [HWND, ctypes.c_int]
u.PostMessageW.argtypes = [HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
u.SetForegroundWindow.argtypes = [HWND]
u.SetLayeredWindowAttributes.argtypes = [HWND, wintypes.DWORD, ctypes.c_ubyte, wintypes.DWORD]

if ctypes.sizeof(ctypes.c_void_p) == 8:
    _GetLong, _SetLong = u.GetWindowLongPtrW, u.SetWindowLongPtrW
else:  # pragma: no cover
    _GetLong, _SetLong = u.GetWindowLongW, u.SetWindowLongW
_GetLong.restype = ctypes.c_ssize_t
_GetLong.argtypes = [HWND, ctypes.c_int]
_SetLong.restype = ctypes.c_ssize_t
_SetLong.argtypes = [HWND, ctypes.c_int, ctypes.c_ssize_t]

GWL_STYLE, GWL_EXSTYLE = -16, -20
WS_CAPTION, WS_THICKFRAME, WS_SYSMENU, WS_MINIMIZEBOX, WS_MAXIMIZEBOX = 0xC00000, 0x40000, 0x80000, 0x20000, 0x10000
WS_POPUP, WS_CHILD, WS_VISIBLE, WS_BORDER, WS_DLGFRAME = 0x80000000, 0x40000000, 0x10000000, 0x800000, 0x400000
WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE, WS_EX_WINDOWEDGE, WS_EX_CLIENTEDGE = 0x40000, 0x80, 0x08000000, 0x100, 0x200
SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE, SWP_FRAMECHANGED, SWP_SHOWWINDOW, SWP_NOZORDER = 0x1, 0x2, 0x10, 0x20, 0x40, 0x4
HWND_BOTTOM, HWND_TOP = HWND(1), HWND(0)


def _cls(h):
    b = ctypes.create_unicode_buffer(256)
    u.GetClassNameW(h, b, 256)
    return b.value


def _title(h):
    b = ctypes.create_unicode_buffer(512)
    u.GetWindowTextW(h, b, 512)
    return b.value


def _rect(h):
    r = wintypes.RECT()
    u.GetWindowRect(h, ctypes.byref(r))
    return r.left, r.top, r.right, r.bottom


def _pid(h):
    p = wintypes.DWORD()
    u.GetWindowThreadProcessId(h, ctypes.byref(p))
    return p.value


_ENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, HWND, ctypes.c_void_p)


def monitors():
    """Elenco dei monitor: principale per primo, poi da sinistra a destra."""
    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

    out = []
    MONENUM = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(wintypes.RECT), ctypes.c_void_p)

    def cb(hm, hdc, lprc, lp):
        mi = MONITORINFO(); mi.cbSize = ctypes.sizeof(MONITORINFO)
        u.GetMonitorInfoW(hm, ctypes.byref(mi))
        r = mi.rcMonitor
        out.append({"x": r.left, "y": r.top, "w": r.right - r.left, "h": r.bottom - r.top, "primary": bool(mi.dwFlags & 1),
                    "work": (mi.rcWork.left, mi.rcWork.top, mi.rcWork.right, mi.rcWork.bottom)})
        return 1

    u.EnumDisplayMonitors.argtypes = [ctypes.c_void_p, ctypes.c_void_p, MONENUM, ctypes.c_void_p]
    u.EnumDisplayMonitors(None, None, MONENUM(cb), None)
    out.sort(key=lambda m: (not m["primary"], m["x"]))
    for i, m in enumerate(out):
        m["i"] = i
    return out


def find_desktop_parent():
    """Restituisce (genitore, finestra dopo cui inserirsi) per il layout di Explorer in uso."""
    prog = u.FindWindowW("Progman", None)
    if not prog:
        return None, None
    res = ctypes.c_size_t(0)
    # chiede a Explorer di creare lo strato "WorkerW" dietro alle icone
    u.SendMessageTimeoutW(prog, 0x052C, 0xD, 0x1, 0, 1000, ctypes.byref(res))
    u.SendMessageTimeoutW(prog, 0x052C, 0, 0, 0, 1000, ctypes.byref(res))
    defview = u.FindWindowExW(prog, None, "SHELLDLL_DefView", None)
    wk_child = u.FindWindowExW(prog, None, "WorkerW", None)
    if defview and wk_child:                 # Windows 11 24H2 e successivi: tutto dentro Progman
        return prog, defview
    holder = []                              # layout classico: WorkerW di primo livello dietro alle icone

    def cb(hw, lp):
        if u.FindWindowExW(hw, None, "SHELLDLL_DefView", None):
            holder.append(hw)
        return True
    u.EnumWindows(_ENUMPROC(cb), 0)
    if holder:
        wk = u.FindWindowExW(None, holder[0], "WorkerW", None)
        if wk:
            return wk, None
    return prog, None


def find_window(pid=None, title_part="", cls="Chrome_WidgetWin_1"):
    """Cerca una finestra di primo livello visibile (classe, titolo, processo)."""
    found = []

    def cb(hw, lp):
        if cls and _cls(hw) != cls:
            return True
        if pid is not None and _pid(hw) != pid:
            return True
        if title_part and title_part not in _title(hw):
            return True
        if not u.IsWindowVisible(hw):
            return True
        found.append(hw)
        return False
    u.EnumWindows(_ENUMPROC(cb), 0)
    return found[0] if found else None


def place(hwnd, parent, mon, insert_after=None):
    """Posiziona hwnd (già figlio di parent) coprendo il monitor mon."""
    pt = wintypes.POINT(mon["x"], mon["y"])
    u.ScreenToClient(parent, ctypes.byref(pt))
    after = insert_after if insert_after else HWND_BOTTOM
    u.SetWindowPos(hwnd, after, pt.x, pt.y, mon["w"], mon["h"], SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW)


def embed(hwnd, mon):
    """Trasforma la finestra in uno sfondo: senza bordi, figlia del desktop, sotto le icone."""
    parent, insert_after = find_desktop_parent()
    if not parent:
        raise RuntimeError("desktop non trovato")
    st = _GetLong(hwnd, GWL_STYLE)
    st &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_POPUP | WS_BORDER | WS_DLGFRAME)
    st |= WS_CHILD | WS_VISIBLE
    _SetLong(hwnd, GWL_STYLE, st)
    ex = _GetLong(hwnd, GWL_EXSTYLE)
    ex &= ~(WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE)
    ex |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
    _SetLong(hwnd, GWL_EXSTYLE, ex)
    u.SetParent(hwnd, parent)
    place(hwnd, parent, mon, insert_after)
    return parent, insert_after


def release(hwnd):
    """Stacca la finestra dal desktop (prima di chiuderla)."""
    try:
        if u.IsWindow(hwnd):
            u.ShowWindow(hwnd, 0)
            u.SetParent(hwnd, None)
    except Exception:
        pass


def focus(hwnd):
    try:
        u.ShowWindow(hwnd, 9)  # SW_RESTORE
        u.SetForegroundWindow(hwnd)
    except Exception:
        pass


def is_alive(hwnd):
    return bool(hwnd) and bool(u.IsWindow(hwnd))


def parent_of(hwnd):
    return u.GetParent(hwnd)


def current_rect_in_parent(hwnd):
    return _rect(hwnd)


_SHELL_CLASSES = {"Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "SHELLDLL_DefView", "SysListView32",
                  "XamlExplorerHostIslandWindow", "TopLevelWindowForOverflowXamlIsland", "Windows.UI.Core.CoreWindow",
                  "NotifyIconOverflowWindow", "ForegroundStaging", "MultitaskingViewFrame"}


def desktop_covered(mon, ignore_pids=()):
    """True se una finestra a schermo intero/massimizzata copre il monitor dello sfondo."""
    try:
        fg = u.GetForegroundWindow()
        if not fg or _cls(fg) in _SHELL_CLASSES or u.IsIconic(fg) or not u.IsWindowVisible(fg):
            return False
        if _pid(fg) in ignore_pids:
            return False
        l, t, r, b = _rect(fg)
        wl, wt, wr, wb = mon["work"]
        ml, mt, mr, mb = mon["x"], mon["y"], mon["x"] + mon["w"], mon["y"] + mon["h"]
        # copre (quasi) tutta l'area di lavoro del monitor?
        ow = min(r, mr) - max(l, ml)
        oh = min(b, mb) - max(t, mt)
        if ow <= 0 or oh <= 0:
            return False
        return ow >= (wr - wl) - 24 and oh >= (wb - wt) - 24
    except Exception:
        return False
