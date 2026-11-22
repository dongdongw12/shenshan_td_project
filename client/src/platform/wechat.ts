/**
 * 微信小游戏适配（未在真机验证：T3 只搭了接口，真机调试见 HANDOFF 分工，由客户端落地方完成）。
 * 小游戏环境没有 DOM：画布来自 wx.createCanvas()，图片来自 wx.createImage()，包内文件用文件系统接口读。
 */
import type { ImageLike, Platform } from "./platform";

interface WxImage {
  width: number;
  height: number;
  src: string;
  onload: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
}

interface Wx {
  createCanvas(): HTMLCanvasElement;
  createImage(): WxImage;
  getSystemInfoSync(): { pixelRatio: number; windowWidth: number; windowHeight: number };
  getFileSystemManager(): {
    readFile(opts: { filePath: string; encoding: "utf8"; success: (r: { data: string }) => void; fail: (e: unknown) => void }): void;
  };
}

declare const wx: Wx;
declare function requestAnimationFrame(cb: (t: number) => void): number;

export class WechatPlatform implements Platform {
  readonly name = "wechat" as const;
  private canvas: HTMLCanvasElement | null = null;

  pixelRatio(): number {
    return Math.min(3, wx.getSystemInfoSync().pixelRatio || 2);
  }

  screenSize(): { w: number; h: number } {
    const s = wx.getSystemInfoSync();
    return { w: s.windowWidth, h: s.windowHeight };
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

  loadImage(src: string): Promise<ImageLike> {
    return new Promise((resolve, reject) => {
      const img = wx.createImage();
      img.onload = () => resolve(img as unknown as ImageLike);
      img.onerror = (e) => reject(new Error(`图片加载失败：${src} ${String(e)}`));
      img.src = src;
    });
  }

  loadJson<T>(src: string): Promise<T> {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath: src,
        encoding: "utf8",
        success: (r) => resolve(JSON.parse(r.data) as T),
        fail: reject,
      });
    });
  }

  requestFrame(cb: (timeMs: number) => void): void {
    requestAnimationFrame(cb);
  }
}
