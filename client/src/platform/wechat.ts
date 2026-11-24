/**
 * 微信小游戏适配。小游戏环境没有 DOM：画布来自 wx.createCanvas()，图片来自 wx.createImage()，
 * 包内文件用文件系统接口读，触摸用 wx.onTouchStart / Move / End。
 */
import type { ImageLike, Platform, PointerEvt } from "./platform";
import type { Voice } from "../app/audio";
import { WebAudioVoice, testBeep, unlockWebAudio, webAudioAvailable, webAudioState } from "./wechatWebAudio";

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
interface WxWindowInfo { pixelRatio: number; windowWidth: number; windowHeight: number; screenHeight: number; statusBarHeight?: number; safeArea?: WxRect }

interface Wx {
  createCanvas(): HTMLCanvasElement;
  createImage(): WxImage;
  /** 新接口（基础库 2.20.1+）：窗口信息；没有时退回已不推荐的 getSystemInfoSync */
  getWindowInfo?(): WxWindowInfo;
  getSystemInfoSync(): WxWindowInfo;
  getMenuButtonBoundingClientRect?(): WxRect;
  getFileSystemManager(): {
    readFile(opts: { filePath: string; encoding: "utf8"; success: (r: { data: string }) => void; fail: (e: unknown) => void }): void;
  };
  onTouchStart(cb: (e: WxTouchEvent) => void): void;
  onTouchMove(cb: (e: WxTouchEvent) => void): void;
  onTouchEnd(cb: (e: WxTouchEvent) => void): void;
  onTouchCancel(cb: (e: WxTouchEvent) => void): void;
  onWindowResize?(cb: () => void): void;
  onHide(cb: () => void): void;
  onShow(cb: () => void): void;
  createInnerAudioContext(): Voice & {
    onError(cb: (e: { errCode: number; errMsg: string }) => void): void;
    onCanplay(cb: () => void): void; onPlay(cb: () => void): void; onPause(cb: () => void): void;
    onStop(cb: () => void): void; onWaiting(cb: () => void): void; onEnded(cb: () => void): void;
  };
  setInnerAudioOption?(opts: { mixWithOther?: boolean; obeyMuteSwitch?: boolean; success?: () => void; fail?: (e: unknown) => void }): void;
  getStorageSync(key: string): unknown;
  env?: { USER_DATA_PATH: string };
  setStorageSync(key: string, value: string): void;
  removeStorageSync(key: string): void;
  getPerformance?(): { now(): number };
}

declare const wx: Wx;
declare function requestAnimationFrame(cb: (t: number) => void): number;

export class WechatPlatform implements Platform {
  readonly name = "wechat" as const;
  private canvas: HTMLCanvasElement | null = null;
  private readonly sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
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

  /**
   * 毫秒时间。wx.getPerformance().now() 的单位各端不一样：iPhone 真机是**微秒**（2026-11-24 真机上 1 倍速快好几倍就是当成毫秒用了），
   * 开发者工具模拟器是毫秒。所以开头 250ms 先用 Date.now()，同时和 performance 对一下表，按比例（≈1 或 ≈1000）定单位，
   * 之后用 performance（更平滑），并且接在 Date.now() 的读数后面，不会跳。
   */
  private readonly p0 = this.perf ? this.perf.now() : 0;
  private readonly d0 = Date.now();
  private perfScale: number | null = null;
  now(): number {
    if (!this.perf) return Date.now();
    if (this.perfScale === null) {
      const dd = Date.now() - this.d0;
      if (dd < 250) return Date.now();
      const ratio = (this.perf.now() - this.p0) / dd;
      this.perfScale = ratio > 100 ? 1000 : 1;
    }
    return this.d0 + (this.perf.now() - this.p0) / this.perfScale;
  }

  onPointer(cb: (e: PointerEvt) => void): void {
    const emit = (type: PointerEvt["type"], pressed: boolean) => (e: WxTouchEvent) => {
      for (const t of e.changedTouches) cb({ type, id: t.identifier, x: t.clientX, y: t.clientY, pressed });
    };
    // 每次按下都顺手解锁一下 WebAudio（iOS 只认触摸回调里的 resume）
    wx.onTouchStart((e) => { unlockWebAudio(); emit("down", true)(e); });
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

  onHide(cb: () => void): void {
    wx.onHide(cb);
  }

  onShow(cb: () => void): void {
    wx.onShow(cb);
  }

  /** InnerAudioContext 本身就有 src / volume / loop / play / stop / pause；默认跟随 iPhone 静音键 */
  makeVoice(): Voice {
    if (!this.audioOptionSet) {
      this.audioOptionSet = true;
      // 和别的音频混播（不打断微信里正在放的东西）；跟随 iPhone 静音键
      wx.setInnerAudioOption?.({ mixWithOther: true, obeyMuteSwitch: true, fail: (e) => console.warn("setInnerAudioOption 失败", e) });
    }
    const ctx = wx.createInnerAudioContext();
    const n = ++this.voiceCount;
    // 出错 / 状态变化只记日志（真机调试的控制台能看到），不打断游戏；背景音乐（loop）的每个事件都打出来
    const tag = () => `[音频#${n}] ${String(ctx.src).split("/").pop()}`;
    const note = (msg: string, always = false) => {
      if (!ctx.loop && !always) return;
      this.logAudio(`${tag()} ${msg}`);
    };
    ctx.onError((e) => note(`出错 ${e?.errCode} ${e?.errMsg}`, true));
    ctx.onCanplay(() => note("可以播放"));
    ctx.onPlay(() => note(`开始播放 vol=${ctx.volume}`));
    ctx.onPause(() => note("暂停"));
    ctx.onStop(() => note("停止"));
    ctx.onWaiting(() => note("缓冲中"));
    return ctx;
  }
  private audioOptionSet = false;
  private audioLog: string[] = [];

  private logAudio(line: string): void {
    console.log(line);
    this.audioLog.push(line);
    if (this.audioLog.length > 6) this.audioLog.shift();
  }

  /** 背景音乐走 WebAudio（InnerAudioContext 在 iOS 上放 1MB 的曲子会一直“缓冲中”），没有 WebAudio 才退回 InnerAudioContext */
  makeMusicVoice(): Voice {
    if (!webAudioAvailable()) return this.makeVoice();
    const n = ++this.voiceCount;
    const v: WebAudioVoice = new WebAudioVoice((msg) => this.logAudio(`[音乐#${n}] ${String(v.src).split("/").pop()} ${msg}`));
    return v;
  }

  /** 真机上开播后改音量不生效（InnerAudio 和 WebAudio 都是），小游戏里背景音乐一律不淡入淡出、开播前定好音量 */
  diagTests(): Record<string, () => void> {
    const log = (m: string) => this.logAudio(`[测试] ${m}`);
    const inner = (src: string, name: string) => {
      const c = wx.createInnerAudioContext();
      c.onPlay(() => log(`${name} 开始`)); c.onWaiting(() => log(`${name} 缓冲中`)); c.onCanplay(() => log(`${name} 可以播放`));
      c.onError((e) => log(`${name} 出错 ${e?.errCode} ${e?.errMsg}`)); c.onEnded(() => log(`${name} 放完`));
      c.volume = 1; c.src = src; c.play();
      setTimeout(() => { try { c.stop(); } catch { /* 忽略 */ } }, 6000);
    };
    const fs = wx.getFileSystemManager() as unknown as { copyFile(o: { srcPath: string; destPath: string; success: () => void; fail: (e: unknown) => void }): void };
    return {
      "哔": () => testBeep(log),
      "音效": () => inner(this.asset("audio/sfx_coin.mp3"), "音效"),
      "WA音效": () => { const v = new WebAudioVoice(log); v.volume = 1; v.src = this.asset("audio/sfx_coin.mp3"); void v.play(); },
      "音乐-复制": () => {
        const dst = `${wx.env?.USER_DATA_PATH ?? ""}/bgm_day_test.mp3`;
        fs.copyFile({ srcPath: this.asset("audio/bgm_day.mp3"), destPath: dst, success: () => inner(dst, "复制的音乐"), fail: (e) => log(`复制失败 ${JSON.stringify(e)}`) });
      },
    };
  }

  musicCanFade(): boolean {
    return false;
  }

  diagnostics(): string[] {
    const s = this.sys as unknown as { system?: string; platform?: string; version?: string; SDKVersion?: string; brand?: string; model?: string };
    const base = (wx as unknown as { getAppBaseInfo?: () => { SDKVersion?: string; version?: string } }).getAppBaseInfo?.();
    const dev = (wx as unknown as { getDeviceInfo?: () => { system?: string; model?: string } }).getDeviceInfo?.();
    return [`${dev?.model ?? s.model ?? "?"} · ${dev?.system ?? s.system ?? "?"} · 微信 ${base?.version ?? s.version ?? "?"} · 基础库 ${base?.SDKVersion ?? s.SDKVersion ?? "?"} · ${webAudioState()}`, ...this.audioLog];
  }
  private voiceCount = 0;

  // 小游戏本地缓存：单个 key 上限 1MB、总共 10MB（存档只有几 KB）
  storageGet(key: string): string | null {
    try { const v = wx.getStorageSync(key); return typeof v === "string" && v ? v : null; } catch { return null; }
  }

  storageSet(key: string, value: string): void {
    try { wx.setStorageSync(key, value); } catch (e) { console.warn("存档写入失败", e); }
  }

  storageRemove(key: string): void {
    try { wx.removeStorageSync(key); } catch { /* 忽略 */ }
  }
}
