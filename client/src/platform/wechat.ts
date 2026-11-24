/**
 * 微信小游戏适配。小游戏环境没有 DOM：画布来自 wx.createCanvas()，图片来自 wx.createImage()，
 * 包内文件用文件系统接口读，触摸用 wx.onTouchStart / Move / End。
 */
import type { ImageLike, Platform, PointerEvt } from "./platform";

interface WxImage {
  width: number;
  height: number;
  src: string;
  onload: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
}

interface WxTouch { identifier: number; clientX: number; clientY: number }
interface WxTouchEvent { changedTouches: WxTouch[]; touches: WxTouch[] }
interface WxRect { top: number; bottom: number; left: number; right: number; width: number; height: number }

interface Wx {
  createCanvas(): HTMLCanvasElement;
  createImage(): WxImage;
  getSystemInfoSync(): { pixelRatio: number; windowWidth: number; windowHeight: number; screenHeight: number; statusBarHeight?: number; safeArea?: WxRect };
  getMenuButtonBoundingClientRect?(): WxRect;
  getFileSystemManager(): {
    readFile(opts: { filePath: string; encoding: "utf8"; success: (r: { data: string }) => void; fail: (e: unknown) => void }): void;
  };
  onTouchStart(cb: (e: WxTouchEvent) => void): void;
  onTouchMove(cb: (e: WxTouchEvent) => void): void;
  onTouchEnd(cb: (e: WxTouchEvent) => void): void;
  onTouchCancel(cb: (e: WxTouchEvent) => void): void;
  onWindowResize?(cb: () => void): void;
  getPerformance?(): { now(): number };
}

declare const wx: Wx;
declare function requestAnimationFrame(cb: (t: number) => void): number;

export class WechatPlatform implements Platform {
  readonly name = "wechat" as const;
  private canvas: HTMLCanvasElement | null = null;
  private readonly sys = wx.getSystemInfoSync();
  private readonly perf = wx.getPerformance?.();

  /** assetRoot：资源在代码包里的目录（分包根目录，见 game.json 的 subpackages） */
  constructor(private readonly assetRoot = "assets") {}

  pixelRatio(): number {
    // 3 倍屏按 2 倍画：画面主要是 128px/m 的精灵，3 倍只多耗显存和填充率，肉眼几乎看不出
    return Math.min(2, this.sys.pixelRatio || 2);
  }

  screenSize(): { w: number; h: number } {
    return { w: this.sys.windowWidth, h: this.sys.windowHeight };
  }

  safeInsets(): { top: number; bottom: number } {
    // 顶部：让开右上角胶囊按钮（「···」「○」）；底部：让开 iPhone 底部横条
    const menu = wx.getMenuButtonBoundingClientRect?.();
    const top = menu && menu.bottom > 0 ? menu.bottom + 6 : (this.sys.statusBarHeight ?? 20) + 8;
    const sa = this.sys.safeArea;
    const bottom = sa && sa.bottom > 0 ? Math.max(0, this.sys.windowHeight - sa.bottom) : 0;
    return { top, bottom };
  }

  mainCanvas(): HTMLCanvasElement {
    if (!this.canvas) {
      this.canvas = wx.createCanvas();
      const { w, h } = this.screenSize();
      const dpr = this.pixelRatio();
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    return this.canvas;
  }

  /** 小游戏里第一次 wx.createCanvas() 是上屏画布，之后创建的都是离屏画布 */
  createOffscreen(w: number, h: number): HTMLCanvasElement {
    this.mainCanvas();
    const c = wx.createCanvas();
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  asset(path: string): string {
    return `${this.assetRoot}/${path}`;
  }

  loadImage(src: string): Promise<ImageLike> {
    return new Promise((resolve, reject) => {
      const img = wx.createImage();
      img.onload = () => resolve(img as unknown as ImageLike);
      img.onerror = (e) => reject(new Error(`图片加载失败：${src} ${JSON.stringify(e)}`));
      img.src = src;
    });
  }

  loadJson<T>(src: string): Promise<T> {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath: src,
        encoding: "utf8",
        success: (r) => resolve(JSON.parse(r.data) as T),
        fail: (e) => reject(new Error(`读取失败 ${src}: ${JSON.stringify(e)}`)),
      });
    });
  }

  requestFrame(cb: (timeMs: number) => void): void {
    requestAnimationFrame(cb);
  }

  now(): number {
    return this.perf ? this.perf.now() : Date.now();
  }

  onPointer(cb: (e: PointerEvt) => void): void {
    const emit = (type: PointerEvt["type"], pressed: boolean) => (e: WxTouchEvent) => {
      for (const t of e.changedTouches) cb({ type, id: t.identifier, x: t.clientX, y: t.clientY, pressed });
    };
    wx.onTouchStart(emit("down", true));
    wx.onTouchMove(emit("move", true));
    wx.onTouchEnd(emit("up", false));
    wx.onTouchCancel(emit("cancel", false));
  }

  onWheel(): void {
    /* 手机上用双指缩放 */
  }

  onResize(cb: () => void): void {
    wx.onWindowResize?.(cb);
  }
}
