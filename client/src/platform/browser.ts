import type { ImageLike, Platform, PointerEvt } from "./platform";

export class BrowserPlatform implements Platform {
  readonly name = "browser" as const;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly assetRoot = "") {}

  pixelRatio(): number {
    return Math.min(3, window.devicePixelRatio || 1);
  }

  screenSize(): { w: number; h: number } {
    const r = this.canvas.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  }

  safeInsets(): { top: number; bottom: number } {
    return { top: 0, bottom: 0 };
  }

  mainCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  createOffscreen(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  asset(path: string): string {
    return `${this.assetRoot}/${path}`;
  }

  loadImage(src: string): Promise<ImageLike> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`图片加载失败：${src}`));
      img.src = src;
    });
  }

  async loadJson<T>(src: string): Promise<T> {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`读取失败 ${src}: ${res.status}`);
    return (await res.json()) as T;
  }

  requestFrame(cb: (timeMs: number) => void): void {
    requestAnimationFrame(cb);
  }

  now(): number {
    return performance.now();
  }

  onPointer(cb: (e: PointerEvt) => void): void {
    const c = this.canvas;
    const pressed = new Set<number>();
    const at = (e: PointerEvent, type: PointerEvt["type"]): PointerEvt => {
      const r = c.getBoundingClientRect();
      // 鼠标恒为 1 号触点，触摸用浏览器给的 pointerId
      const id = e.pointerType === "mouse" ? 1 : e.pointerId;
      return { type, id, x: e.clientX - r.left, y: e.clientY - r.top, pressed: pressed.has(id) };
    };
    c.addEventListener("pointerdown", (e) => {
      const id = e.pointerType === "mouse" ? 1 : e.pointerId;
      pressed.add(id);
      try { c.setPointerCapture(e.pointerId); } catch { /* 脚本合成的事件没有活动指针，捕获会抛错；不影响点击 */ }
      cb(at(e, "down"));
    });
    c.addEventListener("pointermove", (e) => cb(at(e, "move")));
    const end = (type: "up" | "cancel") => (e: PointerEvent) => {
      const ev = at(e, type);
      pressed.delete(ev.id);
      cb({ ...ev, pressed: false });
    };
    c.addEventListener("pointerup", end("up"));
    c.addEventListener("pointercancel", end("cancel"));
  }

  onWheel(cb: (x: number, y: number, deltaY: number) => void): void {
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      cb(e.clientX - r.left, e.clientY - r.top, e.deltaY);
    }, { passive: false });
  }

  onResize(cb: () => void): void {
    window.addEventListener("resize", cb);
  }

  onHide(cb: () => void): void {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") cb(); });
    window.addEventListener("pagehide", cb);
  }

  // 隐私模式 / 禁用存储时 localStorage 会抛错：一律当没有
  storageGet(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  storageSet(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* 存不了就算了 */ }
  }

  storageRemove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* 同上 */ }
  }
}
