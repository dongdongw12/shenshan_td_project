/**
 * 平台适配层：浏览器开发台与微信小游戏共用同一套渲染核心，只有这里不同。
 * 渲染核心只依赖 Canvas2D 的通用子集（drawImage / globalAlpha / path / setTransform），微信小游戏同样支持。
 */

export type ImageLike = CanvasImageSource & { width: number; height: number };

export interface Platform {
  readonly name: "browser" | "wechat";
  /** 物理像素 / 逻辑像素 */
  pixelRatio(): number;
  /** 逻辑像素尺寸 */
  screenSize(): { w: number; h: number };
  /** 主画布（微信小游戏里第一次调用 wx.createCanvas() 得到的就是上屏画布） */
  mainCanvas(): HTMLCanvasElement;
  loadImage(src: string): Promise<ImageLike>;
  loadJson<T>(src: string): Promise<T>;
  requestFrame(cb: (timeMs: number) => void): void;
}
