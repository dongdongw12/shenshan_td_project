/**
 * 画布 UI（即时模式）：小游戏没有 DOM，顶栏 / 底栏 / 面板 / 封面全部每帧画在主画布上。
 * 每帧先 begin()，再按当前游戏状态画各个控件（同时登记可点区域），pointer() 把触摸分给控件；
 * 落在 UI 上的触摸返回 true，不再交给地图（拖动 / 放建筑）。
 * 样式照搬原网页版（play.html 的 CSS）：旧绢底 + 赭墨描边 + 圆角，按钮选中藤黄、主按钮朱砂。
 */
import type { ImageLike, PointerEvt } from "../platform/platform";
import { drawResIcon } from "./icons";

export const COLORS = {
  ink: "#1c1510", paper: "#f1e8d4", bar: "rgba(241,232,212,0.92)", cinnabar: "#b8352a", gamboge: "#d9a838",
  btn: "#fbf6ea", cream: "#fff6e4", hpBack: "#d8ccb2", toast: "rgba(28,21,16,0.85)", toastText: "#f6ecd6",
};
export const FONT = '"PingFang SC", "Hiragino Sans GB", "Songti SC", sans-serif';
export const KAI = '"STKaiti", "Kaiti SC", "KaiTi", "Songti SC", serif';

type Ctx = CanvasRenderingContext2D;

/** 富文本片段：普通文字 / 资源图标 / 加粗 / 淡色 */
export type Seg = string | { icon: string } | { b: string } | { dim: string };
export type Rich = Seg[];

export interface Rect { x: number; y: number; w: number; h: number }

export function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

const font = (size: number, bold = false, family = FONT) => `${bold ? "700 " : ""}${size}px ${family}`;

// 量字宽缓存（每帧几十个按钮反复量同样的字）
const widthCache = new Map<string, number>();
export function textW(c: Ctx, text: string, f: string): number {
  const key = f + "\u0000" + text;
  let w = widthCache.get(key);
  if (w === undefined) {
    c.font = f;
    w = c.measureText(text).width;
    if (widthCache.size > 4000) widthCache.clear();
    widthCache.set(key, w);
  }
  return w;
}

const segText = (s: Seg) => (typeof s === "string" ? s : "b" in s ? s.b : "dim" in s ? s.dim : "");
const iconW = (size: number) => size * 1.15 + 1;

export function richW(c: Ctx, rich: Rich, size: number): number {
  let w = 0;
  for (const s of rich) w += typeof s === "object" && "icon" in s ? iconW(size) : textW(c, segText(s), font(size, typeof s === "object" && "b" in s));
  return w;
}

/** 画一行富文本：(x, y) = 左端、垂直居中线 */
export function drawRich(c: Ctx, rich: Rich, x: number, y: number, size: number, color: string): number {
  c.textBaseline = "middle";
  c.textAlign = "left";
  let cx = x;
  for (const s of rich) {
    if (typeof s === "object" && "icon" in s) {
      const sz = size * 1.15;
      drawResIcon(c, s.icon, cx, y - sz / 2, sz);
      cx += iconW(size);
      continue;
    }
    const bold = typeof s === "object" && "b" in s;
    const dim = typeof s === "object" && "dim" in s;
    const t = segText(s);
    c.font = font(size, bold);
    c.fillStyle = color;
    if (dim) c.globalAlpha *= 0.55;
    c.fillText(t, cx, y);
    if (dim) c.globalAlpha /= 0.55;
    cx += textW(c, t, font(size, bold));
  }
  return cx - x;
}

/** 富文本按宽度折行（逐字断，中文够用）；返回每行的片段 */
export function wrapRich(c: Ctx, rich: Rich, size: number, maxW: number): Rich[] {
  const lines: Rich[] = [[]];
  let w = 0;
  // 避头尾：标点不放在行首（宁可这一行稍微超出一点）
  const NO_START = "，。；：、！？）」』”’…·》";
  const push = (s: Seg, sw: number) => {
    const t = typeof s === "object" && "icon" in s ? "" : segText(s);
    const overflow = w + sw > maxW && lines[lines.length - 1]!.length;
    if (overflow && !(t.length === 1 && NO_START.includes(t) && w + sw <= maxW + sw)) { lines.push([]); w = 0; }
    lines[lines.length - 1]!.push(s);
    w += sw;
  };
  for (const s of rich) {
    if (typeof s === "object" && "icon" in s) { push(s, iconW(size)); continue; }
    if (s === "\n") { lines.push([]); w = 0; continue; }
    const t = segText(s);
    const mk = (piece: string): Seg => (typeof s === "string" ? piece : "b" in s ? { b: piece } : { dim: piece });
    const f = font(size, typeof s === "object" && "b" in s);
    const whole = textW(c, t, f);
    if (w + whole <= maxW) { push(mk(t), whole); continue; }
    for (const ch of t) push(mk(ch), textW(c, ch, f));
  }
  return lines;
}

export interface ButtonSpec {
  key: string;
  label: string;
  sub?: Rich;
  thumb?: ImageLike | null;
  on?: boolean;
  disabled?: boolean;
  primary?: boolean;
  onClick: () => void;
  /** 字号（默认 12） */
  size?: number;
}

interface Region { key: string; r: Rect; kind: "button" | "block" | "scroll"; disabled?: boolean; onClick?: () => void }

export class Ui {
  private regions: Region[] = [];
  private press = new Map<number, { key: string | null; scroll: string | null; x: number; y: number; sy: number; scrolling: boolean }>();
  readonly scroll = new Map<string, number>();
  c!: Ctx;
  w = 0;
  h = 0;

  begin(c: Ctx, w: number, h: number): void {
    this.c = c;
    this.w = w;
    this.h = h;
    this.regions = [];
  }

  /** 挡住地图的区域（栏 / 面板背景） */
  block(key: string, r: Rect): void {
    this.regions.push({ key, r, kind: "block" });
  }

  private hit(x: number, y: number, kind?: Region["kind"]): Region | null {
    for (let k = this.regions.length - 1; k >= 0; k--) {
      const g = this.regions[k]!;
      if (kind && g.kind !== kind) continue;
      if (x >= g.r.x && x <= g.r.x + g.r.w && y >= g.r.y && y <= g.r.y + g.r.h) return g;
    }
    return null;
  }

  isPressed(key: string): boolean {
    for (const p of this.press.values()) if (p.key === key && !p.scrolling) return true;
    return false;
  }

  /** 返回 true = 这次触摸归 UI */
  pointer(e: PointerEvt): boolean {
    if (e.type === "down") {
      const g = this.hit(e.x, e.y);
      if (!g) return false;
      const sc = this.hit(e.x, e.y, "scroll");
      this.press.set(e.id, { key: g.kind === "button" ? g.key : null, scroll: sc?.key ?? null, x: e.x, y: e.y, sy: this.scroll.get(sc?.key ?? "") ?? 0, scrolling: false });
      return true;
    }
    const p = this.press.get(e.id);
    if (!p) return false;
    if (e.type === "move") {
      if (p.scroll && Math.abs(e.y - p.y) > 6) p.scrolling = true;
      if (p.scrolling && p.scroll) this.scroll.set(p.scroll, Math.max(0, p.sy - (e.y - p.y)));
      return true;
    }
    this.press.delete(e.id);
    if (e.type === "up" && p.key && !p.scrolling) {
      const g = this.hit(e.x, e.y, "button");
      if (g && g.key === p.key && !g.disabled) g.onClick?.();
    }
    return true;
  }

  // ------------------------------------------------------------------ 绘制

  /** 栏 / 面板底：旧绢色 + 2px 墨边 + 圆角 + 下方一道硬阴影 */
  panel(r: Rect, radius = 10, fill = COLORS.bar): void {
    const c = this.c;
    c.save();
    roundRect(c, r.x, r.y + 2, r.w, r.h, radius);
    c.fillStyle = "rgba(28,21,16,0.4)";
    c.fill();
    roundRect(c, r.x, r.y, r.w, r.h, radius);
    c.fillStyle = fill;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = COLORS.ink;
    c.stroke();
    c.restore();
  }

  measureButton(b: ButtonSpec): { w: number; h: number } {
    const size = b.size ?? 12;
    const lw = textW(this.c, b.label, font(size, b.primary));
    const sw = b.sub ? richW(this.c, b.sub, size - 2) : 0;
    const tw = b.thumb ? Math.min(46, (30 * b.thumb.width) / Math.max(1, b.thumb.height)) : 0;
    return { w: Math.ceil(Math.max(lw, sw, tw) + 14), h: Math.ceil(8 + (b.thumb ? 31 : 0) + size * 1.3 + (b.sub ? (size - 2) * 1.3 : 0)) };
  }

  /** 滚动面板里画按钮时设成面板可见区：区外的按钮不登记点击（否则会挡住面板外面的地图 / 底栏） */
  clip: Rect | null = null;

  button(b: ButtonSpec, r: Rect): void {
    const c = this.c;
    const size = b.size ?? 12;
    const k = this.clip;
    if (!k) this.regions.push({ key: b.key, r, kind: "button", disabled: b.disabled, onClick: b.onClick });
    else {
      const x0 = Math.max(r.x, k.x), y0 = Math.max(r.y, k.y), x1 = Math.min(r.x + r.w, k.x + k.w), y1 = Math.min(r.y + r.h, k.y + k.h);
      if (x1 > x0 && y1 > y0) this.regions.push({ key: b.key, r: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, kind: "button", disabled: b.disabled, onClick: b.onClick });
    }
    c.save();
    if (b.disabled) c.globalAlpha *= 0.45;
    roundRect(c, r.x, r.y, r.w, r.h, 8);
    c.fillStyle = b.primary ? COLORS.cinnabar : b.on ? COLORS.gamboge : COLORS.btn;
    c.fill();
    if (this.isPressed(b.key) && !b.disabled) { c.fillStyle = "rgba(28,21,16,0.14)"; c.fill(); }
    c.lineWidth = 1.5;
    c.strokeStyle = COLORS.ink;
    c.stroke();
    const color = b.primary ? COLORS.cream : COLORS.ink;
    const contentH = (b.thumb ? 31 : 0) + size * 1.3 + (b.sub ? (size - 2) * 1.3 : 0);
    let y = r.y + (r.h - contentH) / 2;
    const cx = r.x + r.w / 2;
    if (b.thumb) {
      const th = 30, tw = Math.min(46, (th * b.thumb.width) / Math.max(1, b.thumb.height));
      const k = Math.min(tw / b.thumb.width, th / b.thumb.height);
      const dw = b.thumb.width * k, dh = b.thumb.height * k;
      c.drawImage(b.thumb, cx - dw / 2, y + (th - dh) / 2, dw, dh);
      y += 31;
    }
    c.font = font(size, b.primary);
    c.fillStyle = color;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(b.label, cx, y + (size * 1.3) / 2);
    y += size * 1.3;
    if (b.sub) {
      c.globalAlpha *= 0.85;
      const sw = richW(c, b.sub, size - 2);
      drawRich(c, b.sub, cx - sw / 2, y + ((size - 2) * 1.3) / 2, size - 2, color);
    }
    c.restore();
  }

  /**
   * 一组按钮自动换行排进 width 宽的区域（像 CSS flex-wrap，行内垂直居中）。
   * 只量不画时 draw=false，用来先算高度（底栏贴底要先知道自己多高）。
   */
  flow(buttons: ButtonSpec[], x: number, y: number, width: number, gap = 6, draw = true): number {
    const sizes = buttons.map((b) => this.measureButton(b));
    let row: number[] = [], rowW = 0, cy = y;
    const flush = () => {
      if (!row.length) return;
      const rh = Math.max(...row.map((k) => sizes[k]!.h));
      let cx = x;
      for (const k of row) {
        const s = sizes[k]!;
        if (draw) this.button(buttons[k]!, { x: cx, y: cy + (rh - s.h) / 2, w: s.w, h: s.h });
        cx += s.w + gap;
      }
      cy += rh + gap;
      row = [];
      rowW = 0;
    };
    buttons.forEach((_, k) => {
      const s = sizes[k]!;
      if (row.length && rowW + gap + s.w > width) flush();
      rowW += (row.length ? gap : 0) + s.w;
      row.push(k);
    });
    flush();
    return Math.max(0, cy - y - gap);
  }

  /** 可上下拖动滚动的区域：先登记（在其中的按钮后登记、优先命中），返回当前滚动量 */
  scrollArea(key: string, r: Rect, contentH: number): number {
    const max = Math.max(0, contentH - r.h);
    const s = Math.min(max, this.scroll.get(key) ?? 0);
    this.scroll.set(key, s);
    this.regions.push({ key, r, kind: "scroll" });
    return s;
  }

  toast(text: string, y: number, alpha: number): void {
    if (alpha <= 0.01 || !text) return;
    const c = this.c;
    c.save();
    c.globalAlpha = alpha;
    const f = font(14);
    const w = textW(c, text, f) + 28, h = 30;
    roundRect(c, this.w / 2 - w / 2, y, w, h, 15);
    c.fillStyle = COLORS.toast;
    c.fill();
    c.font = f;
    c.fillStyle = COLORS.toastText;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, this.w / 2, y + h / 2 + 0.5);
    c.restore();
  }
}

export { font };
