/**
 * 昼夜时钟与“入夜逐户点灯”。
 *
 * 一个周期 = 白昼 → 黄昏过渡 → 夜晚 → 黎明过渡。nightAlpha 0 = 纯白昼图，1 = 纯夜晚图。
 * 渲染时每个精灵先画白昼图，再以 lightAlpha(nightAlpha, 该建筑的点灯延迟) 叠夜晚图：
 * 黄昏时各户按各自延迟先后亮灯，黎明时按相反顺序熄灯，避免全图同时一刀切。
 * 地影：白昼不透明度 1，夜晚乘 meta.night_shadow_opacity（默认 0.6）。
 *
 * 玩法里夜晚由波次驱动（T4），所以也支持 setPhase() 手动推进，而不只是按时间跑。
 */

export type Phase = "day" | "dusk" | "night" | "dawn";

export interface DayCycleConfig {
  dayS: number;
  duskS: number;
  nightS: number;
  dawnS: number;
}

export const DEFAULT_CYCLE: DayCycleConfig = { dayS: 38, duskS: 4, nightS: 30, dawnS: 3 };

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1)));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class DayNightClock {
  readonly cfg: DayCycleConfig;
  /** 周期内时间（秒） */
  t = 0;
  /** 时间倍率；0 = 暂停（例如等待玩家点“开始夜晚”） */
  speed = 1;

  constructor(cfg: Partial<DayCycleConfig> = {}) {
    this.cfg = { ...DEFAULT_CYCLE, ...cfg };
  }

  get period(): number {
    const c = this.cfg;
    return c.dayS + c.duskS + c.nightS + c.dawnS;
  }

  update(dt: number): void {
    this.t = (this.t + dt * this.speed) % this.period;
    if (this.t < 0) this.t += this.period;
  }

  phase(): Phase {
    const c = this.cfg;
    if (this.t < c.dayS) return "day";
    if (this.t < c.dayS + c.duskS) return "dusk";
    if (this.t < c.dayS + c.duskS + c.nightS) return "night";
    return "dawn";
  }

  /** 跳到某阶段开头 */
  setPhase(p: Phase): void {
    const c = this.cfg;
    this.t = { day: 0, dusk: c.dayS, night: c.dayS + c.duskS, dawn: c.dayS + c.duskS + c.nightS }[p];
  }

  /** 0（白昼）… 1（夜晚），过渡段平滑 */
  nightAlpha(): number {
    const c = this.cfg;
    const t = this.t;
    const duskEnd = c.dayS + c.duskS;
    const nightEnd = duskEnd + c.nightS;
    if (t < c.dayS) return 0;
    if (t < duskEnd) return smoothstep(c.dayS, duskEnd, t);
    if (t < nightEnd) return 1;
    return 1 - smoothstep(nightEnd, this.period, t);
  }
}

/** 单个建筑的点灯进度：delay ∈ [0, 0.6)，越大越晚亮。 */
export function lightAlpha(nightAlpha: number, delay: number): number {
  if (delay <= 0) return nightAlpha;
  return smoothstep(delay, Math.min(1, delay + 0.4), nightAlpha);
}

/** 由 id 稳定地算出点灯延迟（0 … maxDelay） */
export function staggerDelay(id: string, maxDelay = 0.45): number {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) {
    h ^= id.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0xffffffff) * maxDelay;
}

export function shadowOpacity(nightAlpha: number, nightMul = 0.6): number {
  return lerp(1, nightMul, nightAlpha);
}

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

export function mixRgb(a: RGB, b: RGB, t: number): string {
  const c = a.map((v, i) => Math.round(lerp(v, b[i]!, t)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
