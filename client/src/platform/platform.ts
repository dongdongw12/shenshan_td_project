/**
 * 平台适配层：浏览器开发台与微信小游戏共用同一套渲染核心、玩法和画布 UI，只有这里不同。
 * 渲染核心只依赖 Canvas2D 的通用子集（drawImage / globalAlpha / path / setTransform），微信小游戏同样支持。
 */

export type ImageLike = CanvasImageSource & { width: number; height: number };

/** 统一的指针事件（逻辑像素，相对画布左上角）：鼠标 / 触摸都变成这个 */
export interface PointerEvt {
  type: "down" | "move" | "up" | "cancel";
  /** 触点编号（鼠标恒为 1） */
  id: number;
  x: number;
  y: number;
  /** 是不是按着的（鼠标悬停移动时为 false） */
  pressed: boolean;
}

export interface Platform {
  readonly name: "browser" | "wechat";
  /** 物理像素 / 逻辑像素 */
  pixelRatio(): number;
  /** 逻辑像素尺寸 */
  screenSize(): { w: number; h: number };
  /** 上下不能放 UI 的区域（刘海 / 微信右上角胶囊按钮 / 底部横条），逻辑像素 */
  safeInsets(): { top: number; bottom: number };
  /** 主画布（微信小游戏里第一次调用 wx.createCanvas() 得到的就是上屏画布） */
  mainCanvas(): HTMLCanvasElement;
  /** 离屏画布（地面贴图、宣纸纹理等一次性绘制的缓存） */
  createOffscreen(w: number, h: number): HTMLCanvasElement;
  /** 资源路径：传入相对 assets/ 的路径（如 "dev/sprites.json"），返回本平台能加载的地址 */
  asset(path: string): string;
  loadImage(src: string): Promise<ImageLike>;
  loadJson<T>(src: string): Promise<T>;
  requestFrame(cb: (timeMs: number) => void): void;
  now(): number;
  onPointer(cb: (e: PointerEvt) => void): void;
  /** 鼠标滚轮缩放（只有浏览器有） */
  onWheel(cb: (x: number, y: number, deltaY: number) => void): void;
  onResize(cb: () => void): void;
}
