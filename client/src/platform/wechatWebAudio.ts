/**
 * 微信小游戏背景音乐：用 WebAudioContext 播放（整首解码进内存、AudioBufferSourceNode 循环）。
 *
 * 为什么不用 InnerAudioContext：2026-11-24 真机（iPhone 15 Pro Max · iOS 27.2 · 微信 8.0.80 · 基础库 3.18.0）上，
 * 1MB 的背景音乐 onPlay 之后立刻 onWaiting（缓冲中），再也不出声；几十 KB 的音效正常。
 * WebAudio 先把文件读成 ArrayBuffer 解码再放，不走流式缓冲；循环是采样级无缝的，音量也能边放边调（淡入淡出）。
 *
 * 实现成和 InnerAudioContext 一样的 Voice 接口（src / volume / loop / play / pause / stop），混音器不用改。
 */
import type { Voice } from "../app/audio";

interface WaParam { value: number }
interface WaNode { connect(n: unknown): void; disconnect?(): void }
interface WaGain extends WaNode { gain: WaParam }
interface WaBuffer { duration: number }
interface WaSource extends WaNode { buffer: WaBuffer | null; loop: boolean; start(when?: number, offset?: number): void; stop(when?: number): void }
interface WaContext {
  currentTime: number;
  state?: string;
  destination: unknown;
  createGain(): WaGain;
  createBufferSource(): WaSource;
  decodeAudioData(data: ArrayBuffer, ok: (b: WaBuffer) => void, fail?: (e: unknown) => void): void;
  resume?(): Promise<void> | void;
}
interface WxFs { readFile(o: { filePath: string; success: (r: { data: ArrayBuffer }) => void; fail: (e: unknown) => void }): void }
declare const wx: { createWebAudioContext?(): WaContext; getFileSystemManager(): WxFs };

let shared: WaContext | null = null;
export function webAudioAvailable(): boolean {
  return typeof wx !== "undefined" && typeof wx.createWebAudioContext === "function";
}
function context(): WaContext {
  if (!shared) shared = wx.createWebAudioContext!();
  return shared;
}

/**
 * iOS 上 WebAudio 的上下文一开始是 suspended，只有在用户触摸的回调里 resume 才算数（在游戏循环里 resume 无效 → 一直没声）。
 * 平台层在每次 touchstart 里调这个（便宜：已经 running 就什么都不做）。
 */
export function unlockWebAudio(): void {
  if (!webAudioAvailable()) return;
  const ctx = context();
  if (ctx.state !== "running") {
    try { void Promise.resolve(ctx.resume?.()).catch(() => {}); } catch { /* 忽略 */ }
  }
}

/** 排查用：上下文状态 + 当前时间 */
export function webAudioState(): string {
  if (!shared) return "WebAudio 未创建";
  return `WebAudio ${shared.state ?? "?"} t=${shared.currentTime.toFixed(1)}`;
}

/** 解码缓存：同一首只读一次、解一次 */
const buffers = new Map<string, Promise<WaBuffer>>();
function load(src: string): Promise<WaBuffer> {
  let p = buffers.get(src);
  if (!p) {
    p = new Promise<WaBuffer>((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath: src,
        success: (r) => context().decodeAudioData(r.data, resolve, (e) => reject(new Error(`解码失败 ${src} ${JSON.stringify(e)}`))),
        fail: (e) => reject(new Error(`读取失败 ${src} ${JSON.stringify(e)}`)),
      });
    });
    buffers.set(src, p); // 失败也留着：不要每帧重读重解
  }
  return p;
}

export class WebAudioVoice implements Voice {
  src = "";
  loop = false;
  private gainNode: WaGain | null = null;
  private source: WaSource | null = null;
  private vol = 1;
  /** 暂停时记下播到哪了，下次接着放 */
  private offset = 0;
  private startedAt = 0;
  private wantPlay = false;
  private failed = false;

  constructor(private readonly log: (msg: string) => void = () => {}) {}

  get volume(): number { return this.vol; }
  set volume(v: number) {
    this.vol = v;
    if (this.gainNode) this.gainNode.gain.value = v;
  }

  private gain(): WaGain {
    if (!this.gainNode) {
      const ctx = context();
      this.gainNode = ctx.createGain();
      this.gainNode.gain.value = this.vol;
      this.gainNode.connect(ctx.destination);
    }
    return this.gainNode;
  }

  play(): Promise<void> {
    if (this.failed) return Promise.resolve(); // 解不出来就安静，别每帧重试
    this.wantPlay = true;
    const src = this.src;
    const ctx = context();
    void Promise.resolve(ctx.resume?.()).catch(() => {});
    return load(src).then((buf) => {
      if (!this.wantPlay || this.source || src !== this.src) return; // 解码期间被暂停 / 换曲了
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = this.loop;
      s.connect(this.gain());
      const off = buf.duration > 0 ? this.offset % buf.duration : 0;
      s.start(0, off);
      this.startedAt = ctx.currentTime - off;
      this.source = s;
      this.log(`开始播放（WebAudio）vol=${this.vol.toFixed(2)} 从 ${off.toFixed(1)}s，长 ${buf.duration.toFixed(1)}s`);
    }).catch((e: unknown) => {
      this.failed = true;
      this.log(`出错 ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  pause(): void {
    this.wantPlay = false;
    if (!this.source) return;
    this.offset = context().currentTime - this.startedAt;
    try { this.source.stop(); } catch { /* 已经停了 */ }
    this.source.disconnect?.();
    this.source = null;
    this.log("暂停");
  }

  stop(): void {
    this.pause();
    this.offset = 0;
  }
}
