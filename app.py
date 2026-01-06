# -*- coding: utf-8 -*-
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import os
import json
import shutil
import subprocess
import sys
import calendar as pycal
from datetime import datetime, date
from uuid import uuid4
from typing import Optional, Dict, Any, List, Tuple
import random
import math

try:
    from PIL import Image, ImageTk  # type: ignore
    PIL_AVAILABLE = True
except Exception:
    PIL_AVAILABLE = False


APP_TITLE = "NAJU · Gestor de Pacientes (Local)"
PROFILE_FILE = "profile.json"


def _base_dir() -> str:
    try:
        return os.path.dirname(os.path.abspath(__file__))
    except Exception:
        return os.getcwd()


BASE_DIR = _base_dir()
DATA_DIR = os.path.join(BASE_DIR, "data", "patients")


def safe_filename(name: str) -> str:
    invalid = '<>:"/\\|?*'
    cleaned = "".join("_" if c in invalid else c for c in str(name)).strip()
    while "  " in cleaned:
        cleaned = cleaned.replace("  ", " ")
    cleaned = cleaned.strip(" .")
    return cleaned or "SIN_NOMBRE"


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def calc_age(dob_str: str) -> str:
    if not dob_str:
        return ""
    try:
        dob = datetime.strptime(dob_str, "%Y-%m-%d").date()
        today = date.today()
        years = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        return str(years)
    except Exception:
        return ""


def open_path_in_os(path: str) -> None:
    try:
        if sys.platform.startswith("win"):
            os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform.startswith("darwin"):
            subprocess.run(["open", path], check=False)
        else:
            subprocess.run(["xdg-open", path], check=False)
    except Exception:
        messagebox.showerror("Error", "No se pudo abrir la ruta en el sistema.")


def hex_to_rgb(h: str) -> Tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore


def rgb_to_hex(rgb: Tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_color(c1: str, c2: str, t: float) -> str:
    r1, g1, b1 = hex_to_rgb(c1)
    r2, g2, b2 = hex_to_rgb(c2)
    return rgb_to_hex((
        int(lerp(r1, r2, t)),
        int(lerp(g1, g2, t)),
        int(lerp(b1, b2, t)),
    ))


def scramble_text(label: tk.Label, final_text: str, duration_ms=420, interval_ms=35,
                  chars="qwerty1337h@ck3r"):
    steps = max(1, duration_ms // interval_ms)
    i = 0

    def step():
        nonlocal i
        if i >= steps:
            label.config(text=final_text)
            return
        pct = i / steps
        out = []
        for ch in final_text:
            if ch == " ":
                out.append(" ")
            else:
                out.append(ch if random.random() < pct else random.choice(chars))
        label.config(text="".join(out))
        i += 1
        label.after(interval_ms, step)

    step()


def _rounded_polygon_points(x1, y1, x2, y2, r: int) -> List[int]:
    return [
        x1 + r, y1,
        x2 - r, y1,
        x2, y1,
        x2, y1 + r,
        x2, y2 - r,
        x2, y2,
        x2 - r, y2,
        x1 + r, y2,
        x1, y2,
        x1, y2 - r,
        x1, y1 + r,
        x1, y1
    ]


class RoundedCard(tk.Frame):
    def __init__(self, parent, radius=18, padding=14, **kwargs):
        super().__init__(parent, bd=0, highlightthickness=0, **kwargs)
        self.radius = radius
        self.padding = padding
        self.canvas = tk.Canvas(self, bd=0, highlightthickness=0)
        self.canvas.pack(fill=tk.BOTH, expand=True)

        self._shape_id = None
        self.inner = tk.Frame(self.canvas, bd=0, highlightthickness=0)
        self._inner_win = self.canvas.create_window(
            (self.padding, self.padding), window=self.inner, anchor="nw"
        )

        self._fill = "#ffffff"
        self._outline = "#dddddd"
        self._outline_w = 1

        self.canvas.bind("<Configure>", self._redraw)

    def set_colors(self, fill: str, outline: str, outline_w: int = 1):
        self._fill = fill
        self._outline = outline
        self._outline_w = outline_w
        self._redraw()

    def _redraw(self, _e=None):
        w = max(2, self.canvas.winfo_width())
        h = max(2, self.canvas.winfo_height())
        r = min(self.radius, max(8, min(w, h) // 6))
        x1, y1 = 1, 1
        x2, y2 = w - 2, h - 2
        pts = _rounded_polygon_points(x1, y1, x2, y2, r)

        if self._shape_id is None:
            self._shape_id = self.canvas.create_polygon(
                pts, smooth=True, splinesteps=32,
                fill=self._fill, outline=self._outline, width=self._outline_w
            )
        else:
            self.canvas.coords(self._shape_id, *pts)
            self.canvas.itemconfig(self._shape_id, fill=self._fill, outline=self._outline, width=self._outline_w)

        self.canvas.coords(self._inner_win, self.padding, self.padding)
        self.canvas.itemconfig(self._inner_win, width=max(10, w - self.padding * 2))


class HoverGlow:
    """Border glow + soft pulse while hovering."""
    def __init__(self, card: RoundedCard, base_outline: str, hover_outline: str):
        self.card = card
        self.base_outline = base_outline
        self.hover_outline = hover_outline
        self._job = None
        self._pulse_job = None
        self._t = 0.0
        self._dir = 0
        self._pulse_t = 0.0
        self._pulsing = False

    def start(self):
        self._dir = 1
        self._t = 0.0
        self._pulsing = True
        self._cancel()
        self._animate()

    def stop(self):
        self._dir = -1
        self._t = 0.0
        self._pulsing = False
        self._cancel()
        self._animate()

    def _cancel(self):
        if self._job is not None:
            try:
                self.card.after_cancel(self._job)
            except Exception:
                pass
            self._job = None
        if self._pulse_job is not None:
            try:
                self.card.after_cancel(self._pulse_job)
            except Exception:
                pass
            self._pulse_job = None

    def _animate(self):
        steps = 12
        t = min(1.0, self._t / steps)
        eased = 1 - (1 - t) * (1 - t)

        if self._dir == 1:
            col = lerp_color(self.base_outline, self.hover_outline, eased)
            w = int(lerp(1, 3, eased))
        else:
            col = lerp_color(self.hover_outline, self.base_outline, eased)
            w = int(lerp(3, 1, eased))

        self.card.set_colors(self.card._fill, col, w)

        self._t += 1
        if self._t <= steps:
            self._job = self.card.after(16, self._animate)
        else:
            self._job = None
            if self._dir == 1 and self._pulsing:
                self._pulse_t = 0.0
                self._pulse()

    def _pulse(self):
        if not self._pulsing:
            return
        self._pulse_t += 1
        s = (math.sin(self._pulse_t / 8.0) + 1) / 2
        col = lerp_color(self.base_outline, self.hover_outline, 0.55 + 0.45 * s)
        w = 2 + int(s > 0.55)
        self.card.set_colors(self.card._fill, col, w)
        self._pulse_job = self.card.after(70, self._pulse)


class ScrollableFrame(ttk.Frame):
    def __init__(self, parent, bg="#ffffff"):
        super().__init__(parent)
        self.canvas = tk.Canvas(self, highlightthickness=0, borderwidth=0, bg=bg)
        self.vsb = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.inner = ttk.Frame(self.canvas)
        self.inner_id = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.canvas.configure(yscrollcommand=self.vsb.set)
        self.canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.vsb.pack(side=tk.RIGHT, fill=tk.Y)
        self.inner.bind("<Configure>", self._on_inner_configure)
        self.canvas.bind("<Configure>", self._on_canvas_configure)
        self.canvas.bind("<Enter>", lambda _e: self._bind_wheel())
        self.canvas.bind("<Leave>", lambda _e: self._unbind_wheel())

    def _bind_wheel(self):
        self.canvas.bind_all("<MouseWheel>", self._on_mousewheel)
        self.canvas.bind_all("<Button-4>", self._on_mousewheel_linux)
        self.canvas.bind_all("<Button-5>", self._on_mousewheel_linux)

    def _unbind_wheel(self):
        try:
            self.canvas.unbind_all("<MouseWheel>")
            self.canvas.unbind_all("<Button-4>")
            self.canvas.unbind_all("<Button-5>")
        except Exception:
            pass

    def _on_inner_configure(self, _event):
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    def _on_canvas_configure(self, event):
        self.canvas.itemconfig(self.inner_id, width=event.width)

    def _on_mousewheel(self, event):
        self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

    def _on_mousewheel_linux(self, event):
        if event.num == 4:
            self.canvas.yview_scroll(-3, "units")
        elif event.num == 5:
            self.canvas.yview_scroll(3, "units")


class CollapsibleCard(tk.Frame):
    """Rounded card with header + collapsible body (accordion-like)."""
    def __init__(self, parent, title: str, subtitle: str = "", icon: str = "", right_widget: Optional[tk.Widget] = None,
                 radius: int = 22, padding: int = 14, **kwargs):
        super().__init__(parent, bd=0, highlightthickness=0, **kwargs)
        self._expanded = True
        self._anim_job = None

        self.card = RoundedCard(self, radius=radius, padding=padding, bg=self.cget("bg"))
        self.card.pack(fill=tk.BOTH, expand=True)

        self.header = tk.Frame(self.card.inner, bg="#ffffff")
        self.header.pack(fill=tk.X)

        self.left_head = tk.Frame(self.header, bg="#ffffff")
        self.left_head.pack(side=tk.LEFT, fill=tk.X, expand=True)

        self.title_label = tk.Label(self.left_head, text=f"{icon} {title}".strip(),
                                    font=("Segoe UI", 11, "bold"), bg="#ffffff", fg="#111")
        self.title_label.pack(anchor="w")

        self.sub_label = tk.Label(self.left_head, text=subtitle,
                                  font=("Segoe UI", 9), bg="#ffffff", fg="#666")
        if subtitle:
            self.sub_label.pack(anchor="w", pady=(3, 0))

        self.right_head = tk.Frame(self.header, bg="#ffffff")
        self.right_head.pack(side=tk.RIGHT)

        self.chev = tk.Label(self.right_head, text="▾", font=("Segoe UI", 13, "bold"),
                             bg="#ffffff", fg="#666", cursor="hand2")
        self.chev.pack(side=tk.RIGHT)

        if right_widget is not None:
            right_widget.pack(in_=self.right_head, side=tk.RIGHT, padx=(0, 10))

        self.body_canvas = tk.Canvas(self.card.inner, highlightthickness=0, bd=0, height=10)
        self.body_canvas.pack(fill=tk.BOTH, expand=True, pady=(12, 0))

        self.body = tk.Frame(self.body_canvas, bd=0, highlightthickness=0)
        self.body_id = self.body_canvas.create_window((0, 0), window=self.body, anchor="nw")
        self.body.bind("<Configure>", self._on_body_cfg)
        self.body_canvas.bind("<Configure>", self._on_canvas_cfg)

        for w in (self.header, self.left_head, self.title_label, self.sub_label, self.chev):
            w.bind("<Button-1>", lambda _e: self.toggle())

    def set_theme(self, fill: str, border: str, fg: str, muted: str, accent_soft: str):
        self.card.set_colors(fill, border, 1)
        self.header.configure(bg=fill)
        self.left_head.configure(bg=fill)
        self.right_head.configure(bg=fill)
        self.title_label.configure(bg=fill, fg=fg)
        self.sub_label.configure(bg=fill, fg=muted)
        self.chev.configure(bg=fill, fg=muted)
        self.body.configure(bg=fill)
        self.body_canvas.configure(bg=fill)

        def on_enter(_e):
            self.header.configure(bg=accent_soft)
            self.left_head.configure(bg=accent_soft)
            self.right_head.configure(bg=accent_soft)
            self.title_label.configure(bg=accent_soft)
            self.sub_label.configure(bg=accent_soft)
            self.chev.configure(bg=accent_soft)

        def on_leave(_e):
            self.header.configure(bg=fill)
            self.left_head.configure(bg=fill)
            self.right_head.configure(bg=fill)
            self.title_label.configure(bg=fill)
            self.sub_label.configure(bg=fill)
            self.chev.configure(bg=fill)

        for w in (self.header, self.left_head, self.title_label, self.sub_label, self.chev):
            w.bind("<Enter>", on_enter)
            w.bind("<Leave>", on_leave)

    def _on_body_cfg(self, _e=None):
        self.body_canvas.configure(scrollregion=self.body_canvas.bbox("all"))
        if self._expanded:
            self._set_canvas_height(self.body.winfo_reqheight())

    def _on_canvas_cfg(self, e):
        self.body_canvas.itemconfig(self.body_id, width=e.width)

    def toggle(self):
        self._expanded = not self._expanded
        self.chev.configure(text=("▾" if self._expanded else "▸"))
        target = self.body.winfo_reqheight() if self._expanded else 0
        self._animate_height(target)

    def _set_canvas_height(self, h: int):
        self.body_canvas.configure(height=max(0, h))

    def _animate_height(self, target_h: int):
        if self._anim_job is not None:
            try:
                self.after_cancel(self._anim_job)
            except Exception:
                pass
            self._anim_job = None

        start_h = int(self.body_canvas.cget("height"))
        dist = target_h - start_h
        steps = 12
        i = 0

        def step():
            nonlocal i
            t = i / steps
            eased = 1 - (1 - t) * (1 - t)
            h = int(start_h + dist * eased)
            self._set_canvas_height(h)
            i += 1
            if i <= steps:
                self._anim_job = self.after(16, step)
            else:
                self._anim_job = None
                self._set_canvas_height(target_h)

        step()


class DatePicker(tk.Toplevel):
    def __init__(self, parent, theme: Dict[str, str], initial_ymd: str, on_pick):
        super().__init__(parent)
        self.transient(parent)
        self.grab_set()
        self.resizable(False, False)
        self.on_pick = on_pick
        self.t = theme

        try:
            if initial_ymd:
                dt = datetime.strptime(initial_ymd, "%Y-%m-%d")
                self.year = dt.year
                self.month = dt.month
            else:
                today = date.today()
                self.year = today.year
                self.month = today.month
        except Exception:
            today = date.today()
            self.year = today.year
            self.month = today.month

        self.title("Calendario")
        self.configure(bg=self.t["bg"])
        self._build()

    def _build(self):
        card = RoundedCard(self, radius=18, padding=12, bg=self.t["bg"])
        card.pack(fill=tk.BOTH, expand=True, padx=12, pady=12)
        card.set_colors(self.t["card"], self.t["border"], 1)

        body = card.inner
        body.configure(bg=self.t["card"])

        top = tk.Frame(body, bg=self.t["card"])
        top.pack(fill=tk.X)

        self.lbl = tk.Label(top, text="", font=("Segoe UI", 10, "bold"), fg=self.t["fg"], bg=self.t["card"])
        self.lbl.pack(side=tk.LEFT)

        nav = tk.Frame(top, bg=self.t["card"])
        nav.pack(side=tk.RIGHT)

        def nav_btn(text, cmd):
            b = tk.Button(nav, text=text, command=cmd, bd=0,
                          fg=self.t["fg"], bg=self.t["btn_bg"], activebackground=self.t["accent_soft"],
                          padx=10, pady=6, cursor="hand2",
                          highlightthickness=1, highlightbackground=self.t["border"])
            b.pack(side=tk.LEFT, padx=(0, 8))
            return b

        nav_btn("◀", self.prev_month)
        nav_btn("▶", self.next_month)

        self.grid = tk.Frame(body, bg=self.t["card"])
        self.grid.pack(fill=tk.BOTH, expand=True, pady=(12, 0))
        self._render()

    def prev_month(self):
        self.month -= 1
        if self.month < 1:
            self.month = 12
            self.year -= 1
        self._render()

    def next_month(self):
        self.month += 1
        if self.month > 12:
            self.month = 1
            self.year += 1
        self._render()

    def _render(self):
        for w in self.grid.winfo_children():
            w.destroy()

        self.lbl.config(text=f"{pycal.month_name[self.month]} {self.year}")

        headers = ["L", "M", "X", "J", "V", "S", "D"]
        for i, h in enumerate(headers):
            tk.Label(self.grid, text=h, width=4, anchor="center",
                     fg=self.t["muted"], bg=self.t["card"]).grid(row=0, column=i, pady=(0, 6))

        cal = pycal.Calendar(firstweekday=0)
        weeks = cal.monthdayscalendar(self.year, self.month)

        for r, week in enumerate(weeks, start=1):
            for c, day in enumerate(week):
                if day == 0:
                    tk.Label(self.grid, text="", width=4, bg=self.t["card"]).grid(row=r, column=c, padx=1, pady=1)
                else:
                    def mk_pick(d=day):
                        ymd = f"{self.year:04d}-{self.month:02d}-{d:02d}"
                        self.on_pick(ymd)
                        self.destroy()

                    b = tk.Button(self.grid, text=str(day), width=4, command=mk_pick,
                                  bd=0, fg=self.t["fg"], bg=self.t["btn_bg"],
                                  activebackground=self.t["accent_soft"], cursor="hand2",
                                  highlightthickness=1, highlightbackground=self.t["border"])
                    b.grid(row=r, column=c, padx=1, pady=1)


class DateEntry(tk.Frame):
    def __init__(self, parent, theme: Dict[str, str], textvariable: tk.StringVar):
        super().__init__(parent, bg=theme["card"])
        self.var = textvariable
        self.t = theme

        self.ent = ttk.Entry(self, textvariable=self.var)
        self.ent.pack(side=tk.LEFT, fill=tk.X, expand=True)

        btn = tk.Button(self, text="📅", bd=0,
                        fg=self.t["fg"], bg=self.t["btn_bg"],
                        activebackground=self.t["accent_soft"],
                        padx=10, pady=6, cursor="hand2",
                        highlightthickness=1, highlightbackground=self.t["border"],
                        command=self.open)
        btn.pack(side=tk.LEFT, padx=(8, 0))

    def open(self):
        def pick(val):
            self.var.set(val)
        DatePicker(self.winfo_toplevel(), self.t, self.var.get().strip(), pick)


class PatientManagerApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title(APP_TITLE)
        self.root.geometry("1280x840")
        self.root.minsize(1120, 720)

        os.makedirs(DATA_DIR, exist_ok=True)

        # PALETA (cambia aquí si quieres tus hex exactos)
        self.theme_name = "earth"
        self.THEMES: Dict[str, Dict[str, str]] = {
            "earth": {
                "bg": "#f7f2e8",
                "panel": "#fbf6ee",
                "card": "#ffffff",
                "card2": "#f2eadc",
                "border": "#e3d6c2",
                "fg": "#1d1b17",
                "muted": "#6e665c",
                "accent": "#c7a64b",      # dorado suave
                "accent2": "#3f6b4c",     # verde tierra
                "accent_soft": "#efe2c4",
                "btn_bg": "#f3eadb",
                "danger": "#b24a3a",
            }
        }

        self.selected_folder: Optional[str] = None
        self.patient_rows: List[Dict[str, Any]] = []
        self.patient_cards: Dict[str, Dict[str, Any]] = {}
        self._thumb_cache: Dict[str, Any] = {}

        self.style = ttk.Style()
        try:
            self.style.theme_use("clam")
        except Exception:
            pass

        self.view_mode = "list"
        self._anim_job = None
        self._anim_p = 0.0  # 0 list, 1 profile
        self.left_width = 520
        self.gap = 16

        self._build_layout()
        self.apply_theme(self.theme_name)
        self.refresh_patients()
        self._show_welcome()

        self.root.bind("<Control-n>", lambda _e: self.add_patient())
        self.root.bind("<Escape>", lambda _e: self.set_view("list") if self.view_mode == "profile" else None)

    def _build_layout(self):
        t = self.THEMES[self.theme_name]
        self.root.configure(bg=t["bg"])

        self.container = tk.Frame(self.root, bg=t["bg"])
        self.container.pack(fill=tk.BOTH, expand=True)

        self.topbar = tk.Frame(self.container, bg=t["bg"])
        self.topbar.pack(fill=tk.X, padx=18, pady=(16, 12))

        self.btn_back = tk.Button(self.topbar, text="← Pacientes", bd=0, padx=12, pady=8,
                                  cursor="hand2", command=lambda: self.set_view("list"))

        title_block = tk.Frame(self.topbar, bg=t["bg"])
        title_block.pack(side=tk.LEFT)

        self.app_title = tk.Label(title_block, text="NAJU",
                                  font=("Segoe UI", 16, "bold"),
                                  fg=t["fg"], bg=t["bg"])
        self.app_title.pack(anchor="w")

        self.app_sub = tk.Label(title_block, text="pacientes · historia clínica · archivos",
                                font=("Segoe UI", 10),
                                fg=t["muted"], bg=t["bg"])
        self.app_sub.pack(anchor="w", pady=(2, 0))

        self.main = tk.Frame(self.container, bg=t["bg"])
        self.main.pack(fill=tk.BOTH, expand=True, padx=18, pady=(0, 18))
        self.main.bind("<Configure>", lambda _e: self._place_layout())

        self.left = RoundedCard(self.main, radius=26, padding=14, bg=t["bg"])
        self.left.set_colors(t["panel"], t["border"], 1)

        left_in = self.left.inner
        left_in.configure(bg=t["panel"])

        header = tk.Frame(left_in, bg=t["panel"])
        header.pack(fill=tk.X)

        tk.Label(header, text="Pacientes", font=("Segoe UI", 13, "bold"),
                 fg=t["fg"], bg=t["panel"]).pack(anchor="w")

        search_row = tk.Frame(header, bg=t["panel"])
        search_row.pack(fill=tk.X, pady=(12, 0))

        self.search_var = tk.StringVar()
        self.search_entry = ttk.Entry(search_row, textvariable=self.search_var)
        self.search_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self.search_entry.bind("<KeyRelease>", lambda _e: self.refresh_patients())

        self.btn_new = tk.Button(search_row, text="➕", bd=0, padx=10, pady=6,
                                 cursor="hand2", command=self.add_patient)
        self.btn_new.pack(side=tk.LEFT, padx=(10, 0))

        self.btn_refresh = tk.Button(search_row, text="🔄", bd=0, padx=10, pady=6,
                                     cursor="hand2", command=self.refresh_patients)
        self.btn_refresh.pack(side=tk.LEFT, padx=(8, 0))

        self.count_label = tk.Label(header, text="",
                                    font=("Segoe UI", 9),
                                    fg=t["muted"], bg=t["panel"])
        self.count_label.pack(anchor="w", pady=(10, 0))

        self.cards_area = ScrollableFrame(left_in, bg=t["panel"])
        self.cards_area.pack(fill=tk.BOTH, expand=True, pady=(14, 0))

        self.right = tk.Frame(self.main, bg=t["bg"])

        self.profile_header = RoundedCard(self.right, radius=26, padding=16, bg=t["bg"])
        self.profile_header.pack(fill=tk.X, pady=(0, 12))
        self.profile_header.set_colors(t["card"], t["border"], 1)

        ph = self.profile_header.inner
        ph.configure(bg=t["card"])

        self.photo_box = RoundedCard(ph, radius=18, padding=0, bg=t["card"])
        self.photo_box.set_colors(t["card2"], t["border"], 1)
        self.photo_box.pack(side=tk.LEFT)
        self.photo_box.configure(width=140, height=140)
        self.photo_box.pack_propagate(False)

        self.photo_label = tk.Label(self.photo_box.inner, text="", bg=t["card2"])
        self.photo_label.pack(fill=tk.BOTH, expand=True)

        right_info = tk.Frame(ph, bg=t["card"])
        right_info.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(16, 0))

        self.name_label = tk.Label(right_info, text="Seleccione un paciente",
                                   font=("Segoe UI", 18, "bold"),
                                   fg=t["fg"], bg=t["card"])
        self.name_label.pack(anchor="w")

        self.summary_label = tk.Label(right_info, text="",
                                      font=("Segoe UI", 10),
                                      fg=t["fg"], bg=t["card"],
                                      justify="left")
        self.summary_label.pack(anchor="w", pady=(10, 0))

        self.notes_label = tk.Label(right_info, text="",
                                    font=("Segoe UI", 9, "italic"),
                                    fg=t["muted"], bg=t["card"],
                                    justify="left", wraplength=860)
        self.notes_label.pack(anchor="w", pady=(10, 0))

        self.actions = tk.Frame(self.right, bg=t["bg"])
        self.actions.pack(fill=tk.X, pady=(0, 12))

        self.btn_edit = tk.Button(self.actions, text="Editar datos", bd=0, padx=14, pady=8,
                                  cursor="hand2", command=self.edit_patient, state=tk.DISABLED)
        self.btn_photo = tk.Button(self.actions, text="Foto", bd=0, padx=14, pady=8,
                                   cursor="hand2", command=self.set_patient_photo, state=tk.DISABLED)
        self.btn_upload = tk.Button(self.actions, text="Cargar archivos", bd=0, padx=14, pady=8,
                                    cursor="hand2", command=self.upload_files, state=tk.DISABLED)
        self.btn_folder = tk.Button(self.actions, text="Abrir carpeta", bd=0, padx=14, pady=8,
                                    cursor="hand2", command=self.open_patient_folder, state=tk.DISABLED)

        self.btn_edit.pack(side=tk.LEFT, padx=(0, 10))
        self.btn_photo.pack(side=tk.LEFT, padx=(0, 10))
        self.btn_upload.pack(side=tk.LEFT, padx=(0, 10))
        self.btn_folder.pack(side=tk.LEFT)

        self.sections_wrap = tk.Frame(self.right, bg=t["bg"])
        self.sections_wrap.pack(fill=tk.BOTH, expand=True)

        self.btn_new_mse = tk.Button(self.sections_wrap, text="➕ Examen mental formal",
                                     bd=0, padx=14, pady=8, cursor="hand2",
                                     command=self.create_mse, state=tk.DISABLED)

        self.files_section = CollapsibleCard(
            self.sections_wrap,
            title="Archivos del paciente",
            subtitle="Doble click para abrir · incluye todo lo cargado",
            icon="📁",
            radius=26,
            padding=14,
            bg=t["bg"]
        )

        self.evals_section = CollapsibleCard(
            self.sections_wrap,
            title="Evaluaciones",
            subtitle="Registros guardados (Examen mental formal)",
            icon="🧾",
            right_widget=self.btn_new_mse,
            radius=26,
            padding=14,
            bg=t["bg"]
        )

        self.files_section.grid(row=0, column=0, sticky="nsew", padx=(0, 8), pady=(0, 10))
        self.evals_section.grid(row=0, column=1, sticky="nsew", padx=(8, 0), pady=(0, 10))
        self.sections_wrap.grid_columnconfigure(0, weight=1)
        self.sections_wrap.grid_columnconfigure(1, weight=1)
        self.sections_wrap.grid_rowconfigure(0, weight=1)
        self.right.bind("<Configure>", lambda _e: self._layout_sections())

        sf = self.files_section.body
        table_wrap = tk.Frame(sf, bg=t["card"])
        table_wrap.pack(fill=tk.BOTH, expand=True, pady=(4, 0))

        self.docs_tree = ttk.Treeview(table_wrap, columns=("dt", "file"), show="headings", height=15)
        self.docs_tree.heading("dt", text="Fecha y hora")
        self.docs_tree.heading("file", text="Archivo")
        self.docs_tree.column("dt", width=190, anchor=tk.W)
        self.docs_tree.column("file", width=760, anchor=tk.W)

        vsb = ttk.Scrollbar(table_wrap, orient="vertical", command=self.docs_tree.yview)
        self.docs_tree.configure(yscrollcommand=vsb.set)
        self.docs_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        vsb.pack(side=tk.RIGHT, fill=tk.Y)
        self.docs_tree.bind("<Double-1>", self.open_selected_document)

        se = self.evals_section.body
        eval_table_wrap = tk.Frame(se, bg=t["card"])
        eval_table_wrap.pack(fill=tk.BOTH, expand=True, pady=(4, 0))

        self.evals_tree = ttk.Treeview(eval_table_wrap, columns=("dt", "type", "file"), show="headings", height=15)
        self.evals_tree.heading("dt", text="Fecha y hora")
        self.evals_tree.heading("type", text="Tipo")
        self.evals_tree.heading("file", text="Archivo")
        self.evals_tree.column("dt", width=190, anchor=tk.W)
        self.evals_tree.column("type", width=190, anchor=tk.W)
        self.evals_tree.column("file", width=560, anchor=tk.W)

        vsb2 = ttk.Scrollbar(eval_table_wrap, orient="vertical", command=self.evals_tree.yview)
        self.evals_tree.configure(yscrollcommand=vsb2.set)
        self.evals_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        vsb2.pack(side=tk.RIGHT, fill=tk.Y)
        self.evals_tree.bind("<Double-1>", self.open_selected_eval)

        self.status_var = tk.StringVar(value="Listo.")
        self.status = tk.Label(self.right, textvariable=self.status_var,
                               font=("Segoe UI", 9),
                               fg=t["muted"], bg=t["bg"])
        self.status.pack(anchor="w", pady=(10, 0))

        self._hide_back()
        self._place_layout()

    def _layout_sections(self):
        w = self.right.winfo_width()
        if w <= 980:
            if int(self.files_section.grid_info().get("row", 0)) == 0 and int(self.evals_section.grid_info().get("row", 0)) == 0:
                self.files_section.grid_forget()
                self.evals_section.grid_forget()
                self.files_section.grid(row=0, column=0, sticky="nsew", padx=0, pady=(0, 10))
                self.evals_section.grid(row=1, column=0, sticky="nsew", padx=0, pady=(0, 10))
                self.sections_wrap.grid_columnconfigure(0, weight=1)
                self.sections_wrap.grid_rowconfigure(0, weight=1)
                self.sections_wrap.grid_rowconfigure(1, weight=1)
        else:
            if int(self.evals_section.grid_info().get("column", 1)) == 0:
                self.files_section.grid_forget()
                self.evals_section.grid_forget()
                self.files_section.grid(row=0, column=0, sticky="nsew", padx=(0, 8), pady=(0, 10))
                self.evals_section.grid(row=0, column=1, sticky="nsew", padx=(8, 0), pady=(0, 10))
                self.sections_wrap.grid_columnconfigure(0, weight=1)
                self.sections_wrap.grid_columnconfigure(1, weight=1)
                self.sections_wrap.grid_rowconfigure(0, weight=1)

    def _place_layout(self):
        w = max(1, self.main.winfo_width())
        h = max(1, self.main.winfo_height())
        p = self._anim_p

        left_x = int(lerp(0, -(self.left_width + self.gap), p))
        right_x = int(lerp(self.left_width + self.gap, 0, p))
        right_w = w - right_x

        self.left.place(x=left_x, y=0, width=self.left_width, height=h)
        self.right.place(x=right_x, y=0, width=right_w, height=h)

    def _hide_back(self):
        if self.btn_back.winfo_ismapped():
            self.btn_back.pack_forget()

    def _show_back(self):
        if not self.btn_back.winfo_ismapped():
            self.btn_back.pack(side=tk.LEFT, padx=(0, 12))

    def set_view(self, mode: str):
        if mode == self.view_mode:
            return
        self.view_mode = mode
        self._show_back() if mode == "profile" else self._hide_back()
        target = 1.0 if mode == "profile" else 0.0
        self._animate_to(target)
        if mode == "list":
            self.status_var.set("Listo.")

    def _animate_to(self, target: float):
        if self._anim_job is not None:
            try:
                self.root.after_cancel(self._anim_job)
            except Exception:
                pass
            self._anim_job = None

        start = self._anim_p
        dist = target - start
        steps = 18
        i = 0

        def tick():
            nonlocal i
            t = i / steps
            eased = 1 - (1 - t) * (1 - t)
            self._anim_p = start + dist * eased
            self._place_layout()
            i += 1
            if i <= steps:
                self._anim_job = self.root.after(16, tick)
            else:
                self._anim_job = None
                self._anim_p = target
                self._place_layout()

        tick()

    def apply_theme(self, theme_name: str):
        t = self.THEMES[theme_name]
        self.root.configure(bg=t["bg"])
        self.container.configure(bg=t["bg"])
        self.topbar.configure(bg=t["bg"])
        self.app_title.configure(bg=t["bg"], fg=t["fg"])
        self.app_sub.configure(bg=t["bg"], fg=t["muted"])
        self.main.configure(bg=t["bg"])

        def style_btn(b: tk.Button, accent=False):
            b.configure(
                fg=("#111111" if accent else t["fg"]),
                bg=(t["accent"] if accent else t["btn_bg"]),
                activeforeground=("#111111" if accent else t["fg"]),
                activebackground=(t["accent"] if accent else t["accent_soft"]),
                relief="flat",
                highlightthickness=1,
                highlightbackground=(t["accent"] if accent else t["border"]),
                highlightcolor=(t["accent"] if accent else t["border"]),
            )

        style_btn(self.btn_back)
        style_btn(self.btn_new)
        style_btn(self.btn_refresh)

        self.left.configure(bg=t["bg"])
        self.left.set_colors(t["panel"], t["border"], 1)
        self.left.inner.configure(bg=t["panel"])
        self.cards_area.canvas.configure(bg=t["panel"])
        self.count_label.configure(bg=t["panel"], fg=t["muted"])

        self.right.configure(bg=t["bg"])

        self.profile_header.configure(bg=t["bg"])
        self.profile_header.set_colors(t["card"], t["border"], 1)
        self.profile_header.inner.configure(bg=t["card"])

        self.photo_box.set_colors(t["card2"], t["border"], 1)
        self.photo_box.configure(bg=t["card"])
        self.photo_box.inner.configure(bg=t["card2"])
        self.photo_label.configure(bg=t["card2"], fg=t["muted"])

        self.name_label.configure(bg=t["card"], fg=t["fg"])
        self.summary_label.configure(bg=t["card"], fg=t["fg"])
        self.notes_label.configure(bg=t["card"], fg=t["muted"])

        self.actions.configure(bg=t["bg"])
        for b in (self.btn_edit, self.btn_photo, self.btn_upload, self.btn_folder):
            style_btn(b)

        style_btn(self.btn_new_mse, accent=True)

        self.sections_wrap.configure(bg=t["bg"])

        self.files_section.configure(bg=t["bg"])
        self.evals_section.configure(bg=t["bg"])
        self.files_section.set_theme(t["card"], t["border"], t["fg"], t["muted"], t["accent_soft"])
        self.evals_section.set_theme(t["card"], t["border"], t["fg"], t["muted"], t["accent_soft"])

        self.style.configure("Treeview",
                             background=t["panel"],
                             fieldbackground=t["panel"],
                             foreground=t["fg"],
                             rowheight=28,
                             bordercolor=t["border"],
                             lightcolor=t["border"],
                             darkcolor=t["border"])
        self.style.configure("Treeview.Heading",
                             background=t["btn_bg"],
                             foreground=t["fg"],
                             relief="flat")
        self.style.map("Treeview",
                       background=[("selected", t["accent"])],
                       foreground=[("selected", "#111111")])

        self.status.configure(bg=t["bg"], fg=t["muted"])

        self._set_photo_placeholder()
        self._repaint_cards()

    def folder_path(self, folder: str) -> str:
        return os.path.join(DATA_DIR, folder)

    def profile_path(self, folder: str) -> str:
        return os.path.join(self.folder_path(folder), PROFILE_FILE)

    def read_profile(self, folder: str) -> Dict[str, Any]:
        path = self.profile_path(folder)
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def write_profile(self, folder: str, profile: Dict[str, Any]) -> None:
        path = self.profile_path(folder)
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(profile, f, ensure_ascii=False, indent=2)
        except Exception:
            messagebox.showerror("Error", "No se pudo guardar el perfil (profile.json).")

    def refresh_patients(self):
        t = self.THEMES[self.theme_name]
        for w in self.cards_area.inner.winfo_children():
            w.destroy()
        self.patient_cards.clear()

        query = (self.search_var.get() or "").strip().lower()
        folders = sorted([d for d in os.listdir(DATA_DIR) if os.path.isdir(self.folder_path(d))])

        rows: List[Dict[str, Any]] = []
        for folder in folders:
            prof = self.read_profile(folder)
            name = (prof.get("full_name") or folder).strip()
            doc_type = (prof.get("document_type") or "").strip()
            doc_num = (prof.get("document_number") or "").strip()
            doc = (f"{doc_type} {doc_num}".strip() if (doc_type or doc_num) else "")

            dob = (prof.get("date_of_birth") or "").strip()
            age = calc_age(dob)
            city = (prof.get("city") or "").strip()
            occupation = (prof.get("occupation") or "").strip()
            photo = (prof.get("photo_filename") or "").strip()

            hay = f"{name} {doc} {city} {occupation}".lower()
            if query and query not in hay:
                continue

            rows.append({
                "folder": folder,
                "name": name,
                "doc": doc,
                "age": age,
                "city": city,
                "occupation": occupation,
                "photo_filename": photo
            })

        self.patient_rows = rows
        self.count_label.config(text=f"{len(rows)} pacientes")

        self.cards_area.inner.grid_columnconfigure(0, weight=1)
        for i, r in enumerate(rows):
            card = self._create_patient_card(r, t)
            card.grid(row=i, column=0, padx=10, pady=10, sticky="ew")

        self._repaint_cards()

    def _thumb_for(self, folder: str, photo_filename: str, size=(420, 220)):
        key = f"{folder}:{photo_filename}:{size[0]}x{size[1]}:{self.theme_name}"
        if key in self._thumb_cache:
            return self._thumb_cache[key]

        w, h = size
        if not PIL_AVAILABLE:
            img = tk.PhotoImage(width=1, height=1)
            self._thumb_cache[key] = img
            return img

        from PIL import Image, ImageTk  # type: ignore
        base = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        path = os.path.join(self.folder_path(folder), photo_filename) if photo_filename else ""
        if path and os.path.exists(path):
            try:
                im = Image.open(path).convert("RGBA")
                im = im.resize((w, h))
                base = im
            except Exception:
                pass

        overlay = Image.new("RGBA", (w, h), (0, 0, 0, 30))
        base = Image.alpha_composite(base, overlay)

        tkimg = ImageTk.PhotoImage(base)
        self._thumb_cache[key] = tkimg
        return tkimg

    def _create_patient_card(self, data: Dict[str, Any], t: Dict[str, str]) -> RoundedCard:
        folder = data["folder"]
        card = RoundedCard(self.cards_area.inner, radius=26, padding=14, bg=t["panel"])
        card.set_colors(t["card"], t["border"], 1)
        card.configure(height=330)
        card.grid_propagate(False)

        glow = HoverGlow(card, base_outline=t["border"], hover_outline=t["accent"])

        inner = card.inner
        inner.configure(bg=t["card"])

        visual = RoundedCard(inner, radius=18, padding=0, bg=t["card"])
        visual.set_colors(t["card2"], t["border"], 1)
        visual.pack(fill=tk.X)
        visual.configure(height=210)
        visual.pack_propagate(False)

        img_lbl = tk.Label(visual.inner, bg=t["card2"])
        img_lbl.pack(fill=tk.BOTH, expand=True)

        thumb = self._thumb_for(folder, data.get("photo_filename") or "", size=(420, 220))
        img_lbl.config(image=thumb)
        img_lbl.image = thumb

        details = tk.Frame(inner, bg=t["card"])
        details.pack(fill=tk.BOTH, expand=True, pady=(12, 0))

        name_txt = (data.get("name") or "Sin nombre").lower()
        name_lbl = tk.Label(details, text=name_txt,
                            font=("Segoe UI", 14, "bold"),
                            fg=t["fg"], bg=t["card"], anchor="w")
        name_lbl.pack(fill=tk.X)

        meta_parts = []
        if data.get("doc"):
            meta_parts.append(data["doc"])
        if data.get("age"):
            meta_parts.append(f"{data['age']} años")
        meta = " · ".join(meta_parts) if meta_parts else "—"
        meta_lbl = tk.Label(details, text=meta,
                            font=("Segoe UI", 10),
                            fg=t["muted"], bg=t["card"], anchor="w")
        meta_lbl.pack(fill=tk.X, pady=(4, 8))

        desc_parts = []
        if data.get("city"):
            desc_parts.append(data["city"])
        if data.get("occupation"):
            desc_parts.append(data["occupation"])
        desc = " · ".join(desc_parts) if desc_parts else "click para abrir el perfil"
        desc_lbl = tk.Label(details, text=desc,
                            font=("Segoe UI", 10),
                            fg=t["muted"], bg=t["card"],
                            anchor="w", justify="left", wraplength=440)
        desc_lbl.pack(fill=tk.X, pady=(0, 10))

        def on_enter(_e):
            glow.start()
            scramble_text(name_lbl, name_txt, duration_ms=360, interval_ms=35)

        def on_leave(_e):
            if self.selected_folder != folder:
                glow.stop()
            name_lbl.config(text=name_txt)

        def on_click(_e):
            self.load_patient(folder)

        for w in (card, card.canvas, inner, visual, visual.canvas, img_lbl, details, name_lbl, meta_lbl, desc_lbl):
            w.bind("<Enter>", on_enter)
            w.bind("<Leave>", on_leave)
            w.bind("<Button-1>", on_click)

        self.patient_cards[folder] = {"card": card, "glow": glow}
        return card

    def _repaint_cards(self):
        t = self.THEMES[self.theme_name]
        for folder, bundle in self.patient_cards.items():
            card: RoundedCard = bundle["card"]
            if self.selected_folder == folder:
                card.set_colors(card._fill, t["accent"], 3)
            else:
                card.set_colors(card._fill, t["border"], 1)

    def _show_welcome(self):
        self.selected_folder = None
        self.name_label.config(text="Seleccione un paciente")
        self.summary_label.config(text="Abre una tarjeta para ver el perfil.\nEl panel se desliza (fluido, tipo web).")
        self.notes_label.config(text="Atajos: Ctrl+N = nuevo paciente · Esc = volver a lista.")
        self._set_photo_placeholder()
        self._clear_docs()
        self._clear_evals()
        for b in (self.btn_edit, self.btn_photo, self.btn_upload, self.btn_folder, self.btn_new_mse):
            b.config(state=tk.DISABLED)
        self.status_var.set("Listo.")
        self._repaint_cards()

    def load_patient(self, folder: str):
        self.selected_folder = folder
        prof = self.read_profile(folder)
        self.set_view("profile")

        name = (prof.get("full_name") or folder).strip()
        self.name_label.config(text=name)

        dob = (prof.get("date_of_birth") or "").strip()
        age = calc_age(dob)
        doc_type = (prof.get("document_type") or "").strip()
        doc_num = (prof.get("document_number") or "").strip()
        phone = (prof.get("phone") or "").strip()
        email = (prof.get("email") or "").strip()
        sex = (prof.get("sex") or "").strip()
        insurance = (prof.get("insurance") or "").strip()
        emergency = (prof.get("emergency_contact") or "").strip()
        city = (prof.get("city") or "").strip()
        occupation = (prof.get("occupation") or "").strip()
        marital = (prof.get("marital_status") or "").strip()
        reason = (prof.get("chief_complaint") or "").strip()

        lines = []
        if doc_type or doc_num:
            lines.append(f"📄 {doc_type} {doc_num}".strip())
        if dob:
            lines.append(f"🎂 {dob}" + (f" · {age} años" if age else ""))
        if sex:
            lines.append(f"🧬 {sex}")
        if city:
            lines.append(f"📍 {city}")
        if occupation:
            lines.append(f"💼 {occupation}")
        if marital:
            lines.append(f"💍 {marital}")
        if phone:
            lines.append(f"📞 {phone}")
        if email:
            lines.append(f"✉️ {email}")
        if insurance:
            lines.append(f"🏥 {insurance}")
        if emergency:
            lines.append(f"🚨 {emergency}")
        if reason:
            lines.append(f"🗣️ Motivo: {reason}")

        self.summary_label.config(text="\n".join(lines))

        notes = (prof.get("notes") or "").strip()
        if notes:
            preview = notes.replace("\n", " ").strip()
            if len(preview) > 240:
                preview = preview[:240].rstrip() + "…"
            self.notes_label.config(text=preview)
        else:
            self.notes_label.config(text="")

        self._load_patient_photo(folder, prof)
        self.load_docs(folder)
        self.load_evals(folder)

        for b in (self.btn_edit, self.btn_photo, self.btn_upload, self.btn_folder, self.btn_new_mse):
            b.config(state=tk.NORMAL)

        self.status_var.set(f"Abierto: {name}")
        self._repaint_cards()

    def _set_photo_placeholder(self):
        t = self.THEMES[self.theme_name]
        for w in self.photo_box.inner.winfo_children():
            w.destroy()
        canvas = tk.Canvas(self.photo_box.inner, bg=t["card2"], highlightthickness=0)
        canvas.pack(fill=tk.BOTH, expand=True)
        canvas.create_text(70, 70, text="SIN\nFOTO", fill=t["muted"],
                           font=("Segoe UI", 10, "bold"), justify="center")
        self._photo_img_ref = None

    def _load_patient_photo(self, folder: str, prof: Dict[str, Any]):
        t = self.THEMES[self.theme_name]
        for w in self.photo_box.inner.winfo_children():
            w.destroy()

        photo_name = (prof.get("photo_filename") or "").strip()
        if not photo_name:
            self._set_photo_placeholder()
            return

        path = os.path.join(self.folder_path(folder), photo_name)
        if not os.path.exists(path):
            self._set_photo_placeholder()
            return

        try:
            if PIL_AVAILABLE:
                from PIL import Image, ImageTk  # type: ignore
                img = Image.open(path).convert("RGBA").resize((140, 140))
                tk_img = ImageTk.PhotoImage(img)
                lbl = tk.Label(self.photo_box.inner, image=tk_img, bg=t["card2"])
                lbl.pack(fill=tk.BOTH, expand=True)
                self._photo_img_ref = tk_img
            else:
                tk_img = tk.PhotoImage(file=path)
                w0, h0 = tk_img.width(), tk_img.height()
                fx = max(1, w0 // 140)
                fy = max(1, h0 // 140)
                tk_img = tk_img.subsample(fx, fy)
                lbl = tk.Label(self.photo_box.inner, image=tk_img, bg=t["card2"])
                lbl.pack(fill=tk.BOTH, expand=True)
                self._photo_img_ref = tk_img
        except Exception:
            self._set_photo_placeholder()

    def set_patient_photo(self):
        if not self.selected_folder:
            return
        if PIL_AVAILABLE:
            ftypes = [("Imágenes", "*.png *.jpg *.jpeg")]
        else:
            ftypes = [("Imágenes PNG", "*.png")]
        path = filedialog.askopenfilename(title="Seleccionar foto del paciente", filetypes=ftypes)
        if not path:
            return
        ext = os.path.splitext(path)[1].lower()
        if not PIL_AVAILABLE and ext in (".jpg", ".jpeg"):
            messagebox.showwarning("Pillow no instalado", "Para JPG/JPEG instala Pillow o usa PNG.")
            return
        dest_name = f"photo{ext}"
        dest_path = os.path.join(self.folder_path(self.selected_folder), dest_name)
        try:
            shutil.copy2(path, dest_path)
        except Exception:
            messagebox.showerror("Error", "No se pudo copiar la foto a la carpeta del paciente.")
            return
        prof = self.read_profile(self.selected_folder)
        prof["photo_filename"] = dest_name
        prof["updated_at"] = now_str()
        self.write_profile(self.selected_folder, prof)

        for k in list(self._thumb_cache.keys()):
            if k.startswith(f"{self.selected_folder}:"):
                self._thumb_cache.pop(k, None)

        self._load_patient_photo(self.selected_folder, prof)
        self.refresh_patients()
        self.status_var.set("Foto actualizada.")

    def _clear_docs(self):
        for item in self.docs_tree.get_children():
            self.docs_tree.delete(item)

    def load_docs(self, folder: str):
        self._clear_docs()
        ppath = self.folder_path(folder)
        if not os.path.exists(ppath):
            return
        files = sorted(os.listdir(ppath), reverse=True)
        for fn in files:
            low = fn.lower()
            if low == PROFILE_FILE.lower() or low.startswith("photo."):
                continue
            parts = fn.split("_", 2)
            if len(parts) >= 3 and len(parts[0]) == 10 and len(parts[1]) == 8:
                dt = f"{parts[0]} {parts[1].replace('-', ':')}"
                shown = parts[2].replace("_", " ")
            else:
                dt = "---"
                shown = fn.replace("_", " ")
            self.docs_tree.insert("", tk.END, iid=fn, values=(dt, shown))

    def upload_files(self):
        if not self.selected_folder:
            return
        paths = filedialog.askopenfilenames(title="Seleccionar archivos")
        if not paths:
            return
        ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        base = self.folder_path(self.selected_folder)
        copied = 0
        for src in paths:
            filename = os.path.basename(src).replace(" ", "_")
            dest_name = f"{ts}_{filename}"
            dest = os.path.join(base, dest_name)
            if os.path.exists(dest):
                name, ext = os.path.splitext(dest_name)
                i = 2
                while True:
                    cand = os.path.join(base, f"{name}_{i}{ext}")
                    if not os.path.exists(cand):
                        dest = cand
                        break
                    i += 1
            try:
                shutil.copy2(src, dest)
                copied += 1
            except Exception:
                pass
        self.load_docs(self.selected_folder)
        self.load_evals(self.selected_folder)
        self.status_var.set(f"Archivos cargados: {copied}")

    def open_selected_document(self, _event=None):
        if not self.selected_folder:
            return
        sel = self.docs_tree.selection()
        if not sel:
            return
        filename = sel[0]
        path = os.path.join(self.folder_path(self.selected_folder), filename)
        if os.path.exists(path):
            open_path_in_os(path)

    def open_patient_folder(self):
        if not self.selected_folder:
            return
        open_path_in_os(self.folder_path(self.selected_folder))

    def _clear_evals(self):
        for item in self.evals_tree.get_children():
            self.evals_tree.delete(item)

    def load_evals(self, folder: str):
        self._clear_evals()
        ppath = self.folder_path(folder)
        if not os.path.exists(ppath):
            return
        files = sorted(os.listdir(ppath), reverse=True)
        for fn in files:
            low = fn.lower()
            if low == PROFILE_FILE.lower() or low.startswith("photo."):
                continue
            kind = ""
            if "_mse_" in low or "examen_mental_formal" in low:
                kind = "Examen mental formal"
            if not kind:
                continue
            parts = fn.split("_", 3)
            if len(parts) >= 2 and len(parts[0]) == 10 and len(parts[1]) == 8:
                dt = f"{parts[0]} {parts[1].replace('-', ':')}"
                shown = fn.replace("_", " ")
            else:
                dt = "---"
                shown = fn.replace("_", " ")
            self.evals_tree.insert("", tk.END, iid=fn, values=(dt, kind, shown))

    def open_selected_eval(self, _event=None):
        if not self.selected_folder:
            return
        sel = self.evals_tree.selection()
        if not sel:
            return
        filename = sel[0]
        path = os.path.join(self.folder_path(self.selected_folder), filename)
        if os.path.exists(path):
            open_path_in_os(path)

    def add_patient(self):
        self._patient_form("Crear paciente", initial=None, on_save=self._create_patient)

    def edit_patient(self):
        if not self.selected_folder:
            return
        prof = self.read_profile(self.selected_folder)
        self._patient_form("Editar paciente", initial=prof, on_save=self._update_patient)

    def _patient_form(self, title: str, initial: Optional[Dict[str, Any]], on_save):
        t = self.THEMES[self.theme_name]
        dialog = tk.Toplevel(self.root)
        dialog.title(title)
        dialog.geometry("760x860")
        dialog.transient(self.root)
        dialog.grab_set()
        dialog.configure(bg=t["bg"])

        wrapper = tk.Frame(dialog, bg=t["bg"])
        wrapper.pack(fill=tk.BOTH, expand=True, padx=14, pady=14)

        card = RoundedCard(wrapper, radius=26, padding=14, bg=t["bg"])
        card.pack(fill=tk.BOTH, expand=True)
        card.set_colors(t["card"], t["border"], 1)

        body = card.inner
        body.configure(bg=t["card"])

        head = tk.Frame(body, bg=t["card"])
        head.pack(fill=tk.X, pady=(0, 10))

        tk.Label(head, text=title, font=("Segoe UI", 14, "bold"),
                 fg=t["fg"], bg=t["card"]).pack(anchor="w")
        tk.Label(head, text="Calendarios y selectores para agilizar el registro",
                 font=("Segoe UI", 9), fg=t["muted"], bg=t["card"]).pack(anchor="w", pady=(6, 0))

        area = ScrollableFrame(body, bg=t["card"])
        area.pack(fill=tk.BOTH, expand=True, pady=(12, 0))
        area.canvas.configure(bg=t["card"])

        vars_: Dict[str, Any] = {}

        def row_block(label: str) -> tk.Frame:
            r = tk.Frame(area.inner, bg=t["card"])
            r.pack(fill=tk.X, padx=8, pady=7)
            tk.Label(r, text=label, fg=t["fg"], bg=t["card"], font=("Segoe UI", 9)).pack(anchor="w")
            return r

        def add_entry(label: str, key: str):
            r = row_block(label)
            v = tk.StringVar(value=str((initial or {}).get(key, "") or ""))
            e = ttk.Entry(r, textvariable=v)
            e.pack(fill=tk.X, pady=(4, 0))
            vars_[key] = v

        def add_combo(label: str, key: str, values: List[str], allow_typing=False):
            r = row_block(label)
            v = tk.StringVar(value=str((initial or {}).get(key, "") or ""))
            cb = ttk.Combobox(r, textvariable=v, values=values, state=("normal" if allow_typing else "readonly"))
            cb.pack(fill=tk.X, pady=(4, 0))
            vars_[key] = v

        def add_date(label: str, key: str):
            r = row_block(label)
            v = tk.StringVar(value=str((initial or {}).get(key, "") or ""))
            de = DateEntry(r, t, v)
            de.pack(fill=tk.X, pady=(4, 0))
            vars_[key] = v

        def add_text(label: str, key: str, h=5):
            r = row_block(label)
            txt = tk.Text(r, height=h, wrap="word",
                          bg=t["panel"], fg=t["fg"], insertbackground=t["accent"],
                          relief="flat", highlightthickness=1, highlightbackground=t["border"])
            txt.pack(fill=tk.X, pady=(4, 0))
            if initial and (initial.get(key) or ""):
                txt.insert("1.0", str(initial.get(key)))
            vars_[key] = txt

        add_entry("Nombre completo *", "full_name")
        add_combo("Tipo de documento", "document_type", ["", "CC", "TI", "CE", "Pasaporte", "Otro"], allow_typing=True)
        add_entry("Número de documento", "document_number")
        add_date("Fecha de nacimiento", "date_of_birth")
        add_combo("Sexo", "sex", ["", "Masculino", "Femenino", "No binario", "Intersex", "Prefiere no decir"], allow_typing=True)
        add_entry("Teléfono", "phone")
        add_entry("Correo", "email")
        add_entry("Dirección", "address")
        add_entry("Ciudad", "city")
        add_entry("Profesión / Ocupación", "occupation")
        add_combo("Estado civil", "marital_status",
                  ["", "Soltero/a", "Casado/a", "Unión libre", "Separado/a", "Divorciado/a", "Viudo/a", "Otro"],
                  allow_typing=True)
        add_combo("EPS / Seguro", "insurance", ["", "Particular", "EPS", "Prepagada", "Otro"], allow_typing=True)
        add_entry("Contacto de emergencia", "emergency_contact")
        add_entry("Motivo de consulta (breve)", "chief_complaint")
        add_text("Notas (breve)", "notes", h=5)

        photo_path = tk.StringVar(value="")
        r = row_block("Foto (opcional)")
        pbar = tk.Frame(r, bg=t["card"])
        pbar.pack(fill=tk.X, pady=(6, 0))

        p_label = tk.Label(pbar, text="(sin seleccionar)", fg=t["muted"], bg=t["card"],
                           font=("Segoe UI", 9, "italic"), anchor="w")
        p_label.pack(side=tk.LEFT, fill=tk.X, expand=True)

        def pick_photo():
            if PIL_AVAILABLE:
                ftypes = [("Imágenes", "*.png *.jpg *.jpeg")]
            else:
                ftypes = [("Imágenes PNG", "*.png")]
            p = filedialog.askopenfilename(title="Seleccionar foto", filetypes=ftypes)
            if not p:
                return
            ext = os.path.splitext(p)[1].lower()
            if not PIL_AVAILABLE and ext in (".jpg", ".jpeg"):
                messagebox.showwarning("Pillow no instalado", "Para JPG/JPEG instala Pillow o usa PNG.")
                return
            photo_path.set(p)
            p_label.config(text=os.path.basename(p))

        btn_pick = tk.Button(pbar, text="Elegir foto", bd=0, padx=12, pady=8, cursor="hand2", command=pick_photo)
        btn_pick.pack(side=tk.RIGHT)
        btn_pick.configure(bg=t["btn_bg"], fg=t["fg"], activebackground=t["accent_soft"],
                           highlightthickness=1, highlightbackground=t["border"])

        def get_val(k: str) -> str:
            v = vars_[k]
            if isinstance(v, tk.Text):
                return v.get("1.0", "end").strip()
            return str(v.get()).strip()

        def save():
            data = {
                "full_name": get_val("full_name"),
                "document_type": get_val("document_type"),
                "document_number": get_val("document_number"),
                "date_of_birth": get_val("date_of_birth"),
                "sex": get_val("sex"),
                "phone": get_val("phone"),
                "email": get_val("email"),
                "address": get_val("address"),
                "city": get_val("city"),
                "occupation": get_val("occupation"),
                "marital_status": get_val("marital_status"),
                "insurance": get_val("insurance"),
                "emergency_contact": get_val("emergency_contact"),
                "chief_complaint": get_val("chief_complaint"),
                "notes": get_val("notes"),
                "_picked_photo_path": photo_path.get().strip(),
            }
            if not data["full_name"].strip():
                messagebox.showwarning("Falta dato", "El nombre completo es obligatorio.")
                return
            dob = data["date_of_birth"].strip()
            if dob:
                try:
                    datetime.strptime(dob, "%Y-%m-%d")
                except Exception:
                    messagebox.showwarning("Fecha inválida", "Usa AAAA-MM-DD (puedes usar el calendario).")
                    return
            on_save(data, dialog)

        footer = tk.Frame(body, bg=t["card"])
        footer.pack(fill=tk.X, pady=(12, 0))

        btn_cancel = tk.Button(footer, text="Cancelar", bd=0, padx=14, pady=10, cursor="hand2", command=dialog.destroy)
        btn_cancel.pack(side=tk.RIGHT, padx=(10, 0))
        btn_cancel.configure(bg=t["btn_bg"], fg=t["fg"], activebackground=t["accent_soft"],
                             highlightthickness=1, highlightbackground=t["border"])

        btn_save = tk.Button(footer, text="Guardar", bd=0, padx=14, pady=10, cursor="hand2", command=save)
        btn_save.pack(side=tk.RIGHT)
        btn_save.configure(bg=t["accent"], fg="#111111", activebackground=t["accent"],
                           highlightthickness=1, highlightbackground=t["accent"])

    def _create_patient(self, data: Dict[str, Any], dialog: tk.Toplevel):
        pid = uuid4().hex[:10]
        folder = f"{pid}_{safe_filename(str(data['full_name']))[:30]}".strip("_")
        full_path = self.folder_path(folder)
        try:
            os.makedirs(full_path, exist_ok=False)
        except Exception:
            messagebox.showerror("Error", "No se pudo crear la carpeta del paciente.")
            return

        picked_photo = str(data.pop("_picked_photo_path", "")).strip()
        profile = dict(data)
        profile["patient_id"] = pid
        profile["created_at"] = now_str()
        profile["updated_at"] = now_str()
        profile.setdefault("photo_filename", "")

        if picked_photo:
            ext = os.path.splitext(picked_photo)[1].lower()
            dest_name = f"photo{ext}"
            dest_path = os.path.join(full_path, dest_name)
            try:
                shutil.copy2(picked_photo, dest_path)
                profile["photo_filename"] = dest_name
            except Exception:
                pass

        self.write_profile(folder, profile)
        dialog.destroy()
        self.refresh_patients()
        self.load_patient(folder)
        self.status_var.set("Paciente creado.")

    def _update_patient(self, data: Dict[str, Any], dialog: tk.Toplevel):
        if not self.selected_folder:
            return
        prof = self.read_profile(self.selected_folder)
        picked_photo = str(data.pop("_picked_photo_path", "")).strip()

        data["patient_id"] = prof.get("patient_id", "")
        data["created_at"] = prof.get("created_at", "")
        data["updated_at"] = now_str()
        data["photo_filename"] = prof.get("photo_filename", "")

        if picked_photo:
            ext = os.path.splitext(picked_photo)[1].lower()
            dest_name = f"photo{ext}"
            dest_path = os.path.join(self.folder_path(self.selected_folder), dest_name)
            try:
                shutil.copy2(picked_photo, dest_path)
                data["photo_filename"] = dest_name
            except Exception:
                pass

        self.write_profile(self.selected_folder, data)
        dialog.destroy()

        for k in list(self._thumb_cache.keys()):
            if k.startswith(f"{self.selected_folder}:"):
                self._thumb_cache.pop(k, None)

        self.refresh_patients()
        self.load_patient(self.selected_folder)
        self.status_var.set("Datos actualizados.")

    def create_mse(self):
        if not self.selected_folder:
            messagebox.showinfo("Seleccione un paciente", "Primero abre un paciente.")
            return

        t = self.THEMES[self.theme_name]
        dialog = tk.Toplevel(self.root)
        dialog.title("Examen mental formal")
        dialog.geometry("860x900")
        dialog.transient(self.root)
        dialog.grab_set()
        dialog.configure(bg=t["bg"])

        wrapper = tk.Frame(dialog, bg=t["bg"])
        wrapper.pack(fill=tk.BOTH, expand=True, padx=14, pady=14)

        card = RoundedCard(wrapper, radius=26, padding=14, bg=t["bg"])
        card.pack(fill=tk.BOTH, expand=True)
        card.set_colors(t["card"], t["border"], 1)
        body = card.inner
        body.configure(bg=t["card"])

        head = tk.Frame(body, bg=t["card"])
        head.pack(fill=tk.X, pady=(0, 10))
        tk.Label(head, text="Examen mental formal", font=("Segoe UI", 14, "bold"),
                 fg=t["fg"], bg=t["card"]).pack(anchor="w")
        tk.Label(head, text="Selectores + texto libre · se guarda como TXT y JSON dentro del paciente",
                 font=("Segoe UI", 9), fg=t["muted"], bg=t["card"]).pack(anchor="w", pady=(6, 0))

        area = ScrollableFrame(body, bg=t["card"])
        area.pack(fill=tk.BOTH, expand=True, pady=(12, 0))
        area.canvas.configure(bg=t["card"])

        vars_: Dict[str, Any] = {}

        def section(title_txt: str, subtitle: str = ""):
            sec = RoundedCard(area.inner, radius=22, padding=12, bg=t["card"])
            sec.pack(fill=tk.X, padx=8, pady=8)
            sec.set_colors(t["panel"], t["border"], 1)
            sec.inner.configure(bg=t["panel"])
            tk.Label(sec.inner, text=title_txt, font=("Segoe UI", 11, "bold"),
                     fg=t["fg"], bg=t["panel"]).pack(anchor="w")
            if subtitle:
                tk.Label(sec.inner, text=subtitle, font=("Segoe UI", 9),
                         fg=t["muted"], bg=t["panel"]).pack(anchor="w", pady=(4, 8))
            return sec.inner

        def row(parent, label: str) -> tk.Frame:
            r = tk.Frame(parent, bg=t["panel"])
            r.pack(fill=tk.X, pady=6)
            tk.Label(r, text=label, fg=t["fg"], bg=t["panel"], font=("Segoe UI", 9)).pack(anchor="w")
            return r

        def add_entry(parent, label: str, key: str, default=""):
            r = row(parent, label)
            v = tk.StringVar(value=default)
            e = ttk.Entry(r, textvariable=v)
            e.pack(fill=tk.X, pady=(4, 0))
            vars_[key] = v

        def add_combo(parent, label: str, key: str, values: List[str], default=""):
            r = row(parent, label)
            v = tk.StringVar(value=default)
            cb = ttk.Combobox(r, textvariable=v, values=values, state="readonly")
            cb.pack(fill=tk.X, pady=(4, 0))
            vars_[key] = v

        def add_date(parent, label: str, key: str, default=""):
            r = row(parent, label)
            v = tk.StringVar(value=default)
            de = DateEntry(r, t, v)
            de.pack(fill=tk.X, pady=(4, 0))
            vars_[key] = v

        def add_text(parent, label: str, key: str, h=4, default=""):
            r = row(parent, label)
            txt = tk.Text(r, height=h, wrap="word",
                          bg=t["card"], fg=t["fg"], insertbackground=t["accent"],
                          relief="flat", highlightthickness=1, highlightbackground=t["border"])
            txt.pack(fill=tk.X, pady=(4, 0))
            if default:
                txt.insert("1.0", default)
            vars_[key] = txt

        def add_choice(parent, label: str, key: str, options: List[str], default="No"):
            r = row(parent, label)
            v = tk.StringVar(value=default)
            wrap = tk.Frame(r, bg=t["panel"])
            wrap.pack(fill=tk.X, pady=(4, 0))
            for opt in options:
                rb = tk.Radiobutton(wrap, text=opt, value=opt, variable=v,
                                    bg=t["panel"], fg=t["fg"],
                                    activebackground=t["panel"], selectcolor=t["card2"])
                rb.pack(side=tk.LEFT, padx=(0, 14))
            vars_[key] = v

        def get_val(k: str) -> str:
            v = vars_[k]
            if isinstance(v, tk.Text):
                return v.get("1.0", "end").strip()
            return str(v.get()).strip()

        s0 = section("🧾 Datos generales")
        add_date(s0, "Fecha", "mse_date", default=date.today().strftime("%Y-%m-%d"))
        add_entry(s0, "Evaluador/a (opcional)", "mse_evaluator", default="")
        add_entry(s0, "Contexto / setting (breve)", "mse_setting", default="")

        s1 = section("👤 Apariencia y conducta", "Observables: aseo, actitud, contacto visual, psicomotricidad, lenguaje.")
        add_combo(s1, "Aseo / presentación", "appearance_grooming",
                  ["Adecuado", "Descuidado", "Excesivo", "No valorable"], default="Adecuado")
        add_combo(s1, "Actitud hacia la entrevista", "behavior_attitude",
                  ["Colaborador/a", "Resistente", "Hostil", "Retraído/a", "Ambivalente", "No valorable"], default="Colaborador/a")
        add_combo(s1, "Contacto visual", "behavior_eye_contact",
                  ["Adecuado", "Evita la mirada", "Fijación intensa", "Intermitente", "No valorable"], default="Adecuado")
        add_combo(s1, "Psicomotricidad", "behavior_motor",
                  ["Normal", "Agitado/a", "Inhibido/a", "Temblor", "Tics", "Catatónico", "No valorable"], default="Normal")
        add_combo(s1, "Lenguaje / habla", "speech",
                  ["Normal", "Acelerado", "Lento", "Bajo volumen", "Presionado", "Monótono", "Disártrico", "No valorable"], default="Normal")
        add_text(s1, "Observaciones adicionales", "appearance_notes", h=3)

        s2 = section("🌿 Ánimo y afecto", "El ánimo es subjetivo; el afecto es la expresión observable.")
        add_combo(s2, "Ánimo (reportado)", "mood",
                  ["Eutímico", "Ansioso", "Deprimido", "Irritable", "Eufórico", "Lábil", "No valorable"], default="Eutímico")
        add_combo(s2, "Afecto (rango)", "affect_range",
                  ["Pleno", "Restringido", "Plano", "Lábil", "Incongruente", "No valorable"], default="Pleno")
        add_combo(s2, "Congruencia con el contenido", "affect_congruence",
                  ["Congruente", "Parcialmente congruente", "Incongruente", "No valorable"], default="Congruente")
        add_text(s2, "Notas (ánimo/afecto)", "mood_notes", h=3)

        s3 = section("🧠 Pensamiento", "Forma (cómo piensa) y contenido (qué piensa).")
        add_combo(s3, "Curso / forma del pensamiento", "thought_form",
                  ["Lógico y coherente", "Tangencial", "Circunstancial", "Disgregado", "Bloqueos", "Fuga de ideas", "Perseveración", "No valorable"],
                  default="Lógico y coherente")
        add_choice(s3, "Ideas delirantes / creencias extrañas", "delusions", ["No", "Sí"], default="No")
        add_choice(s3, "Ideas obsesivas / rumiaciones", "obsessions", ["No", "Sí"], default="No")
        add_choice(s3, "Ideación suicida", "suicidal_ideation", ["No", "Sí"], default="No")
        add_choice(s3, "Plan suicida (si aplica)", "suicidal_plan", ["No", "Sí", "No aplica"], default="No aplica")
        add_choice(s3, "Ideación homicida", "homicidal_ideation", ["No", "Sí"], default="No")
        add_text(s3, "Contenido del pensamiento (resumen)", "thought_content", h=4)

        s4 = section("👁️ Percepción", "Alucinaciones e ilusiones; despersonalización/desrealización.")
        add_choice(s4, "Alucinaciones", "hallucinations", ["No", "Sí"], default="No")
        add_combo(s4, "Tipo (si aplica)", "hallucinations_type",
                  ["No aplica", "Auditivas", "Visuales", "Táctiles", "Olfativas", "Gustativas", "Mixtas"], default="No aplica")
        add_choice(s4, "Despersonalización / desrealización", "depersonalization", ["No", "Sí"], default="No")
        add_text(s4, "Notas (percepción)", "perception_notes", h=3)

        s5 = section("🧩 Cognición", "Orientación, atención, memoria, abstracción.")
        add_combo(s5, "Orientación", "orientation",
                  ["Orientado/a x3 (tiempo, lugar, persona)", "Parcialmente orientado/a", "Desorientado/a", "No valorable"],
                  default="Orientado/a x3 (tiempo, lugar, persona)")
        add_combo(s5, "Atención / concentración", "attention",
                  ["Adecuada", "Distraíble", "Hipervigilante", "Dificultad marcada", "No valorable"], default="Adecuada")
        add_combo(s5, "Memoria", "memory",
                  ["Conservada", "Alteración leve", "Alteración moderada", "Alteración severa", "No valorable"], default="Conservada")
        add_combo(s5, "Pensamiento abstracto", "abstraction",
                  ["Adecuado", "Concreto", "No valorable"], default="Adecuado")
        add_text(s5, "Notas (cognición)", "cognition_notes", h=3)

        s6 = section("⚖️ Insight y juicio", "Insight: conciencia del problema. Juicio: toma de decisiones.")
        add_combo(s6, "Insight", "insight",
                  ["Adecuado", "Parcial", "Pobre", "Ausente", "No valorable"], default="Parcial")
        add_combo(s6, "Juicio", "judgement",
                  ["Adecuado", "Comprometido", "Gravemente comprometido", "No valorable"], default="Adecuado")
        add_text(s6, "Notas (insight/juicio)", "insight_notes", h=3)

        s7 = section("🛡️ Evaluación de riesgo", "Resumen clínico y plan de seguridad si aplica.")
        add_combo(s7, "Nivel de riesgo actual", "risk_level",
                  ["Bajo", "Moderado", "Alto", "No valorable"], default="Bajo")
        add_text(s7, "Factores de riesgo (breve)", "risk_factors", h=3)
        add_text(s7, "Factores protectores (breve)", "protective_factors", h=3)
        add_text(s7, "Plan de seguridad / acuerdos", "safety_plan", h=4)

        s8 = section("🧾 Impresión clínica y plan", "Conclusión breve y próximos pasos.")
        add_text(s8, "Impresión / resumen", "impression", h=5)
        add_text(s8, "Plan / recomendaciones", "plan", h=4)
        add_date(s8, "Próxima cita (opcional)", "next_appointment", default="")

        footer = tk.Frame(body, bg=t["card"])
        footer.pack(fill=tk.X, pady=(12, 0))

        def save_mse():
            mse: Dict[str, Any] = {}
            for k in vars_.keys():
                mse[k] = get_val(k)

            if not mse.get("mse_date"):
                messagebox.showwarning("Falta fecha", "La fecha es obligatoria.")
                return
            try:
                datetime.strptime(mse["mse_date"], "%Y-%m-%d")
            except Exception:
                messagebox.showwarning("Fecha inválida", "La fecha debe ser AAAA-MM-DD.")
                return

            ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            base = self.folder_path(self.selected_folder)  # type: ignore[arg-type]
            json_name = f"{ts}_mse_examen_mental_formal.json"
            txt_name = f"{ts}_mse_examen_mental_formal.txt"
            json_path = os.path.join(base, json_name)
            txt_path = os.path.join(base, txt_name)

            def line(label: str, key: str) -> str:
                return f"{label}: {mse.get(key, '').strip()}"

            txt_lines = []
            txt_lines.append("EXAMEN MENTAL FORMAL")
            txt_lines.append(f"Guardado: {now_str()}")
            txt_lines.append("")
            txt_lines.append("[Datos generales]")
            txt_lines.append(line("Fecha", "mse_date"))
            txt_lines.append(line("Evaluador/a", "mse_evaluator"))
            txt_lines.append(line("Contexto", "mse_setting"))
            txt_lines.append("")
            txt_lines.append("[Apariencia y conducta]")
            txt_lines.append(line("Aseo", "appearance_grooming"))
            txt_lines.append(line("Actitud", "behavior_attitude"))
            txt_lines.append(line("Contacto visual", "behavior_eye_contact"))
            txt_lines.append(line("Psicomotricidad", "behavior_motor"))
            txt_lines.append(line("Lenguaje/habla", "speech"))
            txt_lines.append(line("Observaciones", "appearance_notes"))
            txt_lines.append("")
            txt_lines.append("[Ánimo y afecto]")
            txt_lines.append(line("Ánimo", "mood"))
            txt_lines.append(line("Afecto", "affect_range"))
            txt_lines.append(line("Congruencia", "affect_congruence"))
            txt_lines.append(line("Notas", "mood_notes"))
            txt_lines.append("")
            txt_lines.append("[Pensamiento]")
            txt_lines.append(line("Forma/curso", "thought_form"))
            txt_lines.append(line("Delirios", "delusions"))
            txt_lines.append(line("Obsesiones", "obsessions"))
            txt_lines.append(line("Ideación suicida", "suicidal_ideation"))
            txt_lines.append(line("Plan suicida", "suicidal_plan"))
            txt_lines.append(line("Ideación homicida", "homicidal_ideation"))
            txt_lines.append(line("Contenido", "thought_content"))
            txt_lines.append("")
            txt_lines.append("[Percepción]")
            txt_lines.append(line("Alucinaciones", "hallucinations"))
            txt_lines.append(line("Tipo", "hallucinations_type"))
            txt_lines.append(line("Despersonalización/desrealización", "depersonalization"))
            txt_lines.append(line("Notas", "perception_notes"))
            txt_lines.append("")
            txt_lines.append("[Cognición]")
            txt_lines.append(line("Orientación", "orientation"))
            txt_lines.append(line("Atención", "attention"))
            txt_lines.append(line("Memoria", "memory"))
            txt_lines.append(line("Abstracción", "abstraction"))
            txt_lines.append(line("Notas", "cognition_notes"))
            txt_lines.append("")
            txt_lines.append("[Insight y juicio]")
            txt_lines.append(line("Insight", "insight"))
            txt_lines.append(line("Juicio", "judgement"))
            txt_lines.append(line("Notas", "insight_notes"))
            txt_lines.append("")
            txt_lines.append("[Riesgo]")
            txt_lines.append(line("Nivel", "risk_level"))
            txt_lines.append(line("Factores de riesgo", "risk_factors"))
            txt_lines.append(line("Protectores", "protective_factors"))
            txt_lines.append(line("Plan de seguridad", "safety_plan"))
            txt_lines.append("")
            txt_lines.append("[Impresión y plan]")
            txt_lines.append(line("Impresión", "impression"))
            txt_lines.append(line("Plan", "plan"))
            txt_lines.append(line("Próxima cita", "next_appointment"))
            txt_lines.append("")

            try:
                with open(json_path, "w", encoding="utf-8") as f:
                    json.dump(mse, f, ensure_ascii=False, indent=2)
                with open(txt_path, "w", encoding="utf-8") as f:
                    f.write("\n".join(txt_lines))
            except Exception:
                messagebox.showerror("Error", "No se pudo guardar el examen mental.")
                return

            self.load_docs(self.selected_folder)  # type: ignore[arg-type]
            self.load_evals(self.selected_folder)  # type: ignore[arg-type]
            self.status_var.set("Examen mental guardado.")
            dialog.destroy()

        btn_cancel = tk.Button(footer, text="Cancelar", bd=0, padx=14, pady=10,
                               cursor="hand2", command=dialog.destroy)
        btn_cancel.pack(side=tk.RIGHT, padx=(10, 0))
        btn_cancel.configure(bg=t["btn_bg"], fg=t["fg"], activebackground=t["accent_soft"],
                             highlightthickness=1, highlightbackground=t["border"])

        btn_save = tk.Button(footer, text="Guardar examen mental", bd=0, padx=14, pady=10,
                             cursor="hand2", command=save_mse)
        btn_save.pack(side=tk.RIGHT)
        btn_save.configure(bg=t["accent"], fg="#111111", activebackground=t["accent"],
                           highlightthickness=1, highlightbackground=t["accent"])

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    root = tk.Tk()
    app = PatientManagerApp(root)
    app.run()
