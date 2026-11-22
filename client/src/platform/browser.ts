import type { ImageLike, Platform } from "./platform";

export class BrowserPlatform implements Platform {
  readonly name = "browser" as const;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  pixelRatio(): number {
    return Math.min(3, window.devicePixelRatio || 1);
  }

  screenSize(): { w: number; h: number } {
    const r = this.canvas.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
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
}
