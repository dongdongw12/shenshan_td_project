/**
 * 声音：背景音乐（白天 / 夜里两首循环，切换时交叉淡入淡出）+ 音效。
 * 平台只要给一个“声道”工厂：浏览器用 HTMLAudioElement，小游戏用 wx.createInnerAudioContext —— 两者接口几乎一样。
 * - 音效用 8 个声道轮流放；同一个音效有最短间隔（箭一秒射很多支，不能每支都响）
 * - 静音状态存在本地（key shenshan_mute）
 * - 浏览器要等第一次点击才能出声：音乐在点“开荒 / 继续”时才开始放（那次点击里调用）
 */

export interface Voice {
  src: string;
  volume: number;
  loop: boolean;
  play(): unknown;
  /** 停下并回到开头 */
  stop(): void;
  pause(): void;
}

export interface AudioHost {
  makeVoice(): Voice;
  /** 背景音乐专用声道（可选） */
  makeMusicVoice?(): Voice;
  url(name: string): string;
  storageGet(key: string): string | null;
  storageSet(key: string, value: string): void;
}

/** 各音效的音量和最短间隔（秒） */
const SFX: Record<string, { vol: number; gap: number }> = {
  ui_tap: { vol: 0.45, gap: 0.05 }, build: { vol: 0.8, gap: 0.1 }, upgrade: { vol: 0.8, gap: 0.2 }, deny: { vol: 0.6, gap: 0.25 },
  shot: { vol: 0.35, gap: 0.09 }, fire_shot: { vol: 0.45, gap: 0.15 }, hit: { vol: 0.35, gap: 0.07 }, flee: { vol: 0.55, gap: 0.12 },
  coin: { vol: 0.5, gap: 0.12 }, night: { vol: 0.9, gap: 2 }, dawn: { vol: 0.8, gap: 2 }, victory: { vol: 0.9, gap: 3 },
  defeat: { vol: 0.9, gap: 3 }, reward: { vol: 0.8, gap: 0.5 }, joy: { vol: 0.75, gap: 1 }, destroyed: { vol: 0.7, gap: 0.3 },
};
const MUSIC_VOL = 0.75;
const FADE_S = 1.6;
const MUTE_KEY = "shenshan_mute";
/** 音效声道数（加上两首背景音乐不超过 8 个播放器：手机上播放器开太多，后开的会把先开的挤掉） */
const SFX_VOICES = 6;

interface Track { voice: Voice; vol: number; target: number; playing: boolean }

export class Mixer {
  private pool: Voice[] = [];
  private next = 0;
  private last = new Map<string, number>();
  private tracks = new Map<string, Track>();
  private current: string | null = null;
  private clock = 0;
  private hidden = false;
  /** 能不能边放边调音量（淡入淡出）。微信 iOS 上播放开始后再改 volume 不一定生效 → 小游戏里不淡，直接切 */
  private readonly fades: boolean;
  muted: boolean;

  constructor(private readonly host: AudioHost & { fades?: boolean }) {
    this.muted = host.storageGet(MUTE_KEY) === "1";
    this.fades = host.fades ?? true;
  }

  private voice(): Voice {
    if (this.pool.length < SFX_VOICES) {
      const v = this.host.makeVoice();
      this.pool.push(v);
      return v;
    }
    const v = this.pool[this.next]!;
    this.next = (this.next + 1) % this.pool.length;
    return v;
  }

  sfx(name: string, volume = 1): void {
    if (this.muted || this.hidden) return;
    const def = SFX[name] ?? { vol: 0.6, gap: 0.1 };
    const lastT = this.last.get(name) ?? -9;
    if (this.clock - lastT < def.gap) return;
    this.last.set(name, this.clock);
    try {
      const v = this.voice();
      v.stop();
      v.src = this.host.url(`sfx_${name}`);
      v.loop = false;
      v.volume = Math.max(0, Math.min(1, def.vol * volume));
      void Promise.resolve(v.play()).catch(() => {});
    } catch { /* 声音出错不影响游戏 */ }
  }

  /** 排查用：一行声音状态 */
  diag(): string {
    const tr = [...this.tracks.entries()].map(([n, t]) => `${n}:${t.playing ? "放" : "停"}${t.vol.toFixed(2)}`).join(" ");
    return `声音 ${this.muted ? "静音" : "开"}${this.hidden ? "·后台" : ""} 淡入${this.fades ? "开" : "关"} 曲=${this.current ?? "-"} [${tr}] 音效声道${this.pool.length}`;
  }

  /** 切到这首背景音乐（同一首不重来）；null = 停 */
  music(name: string | null): void {
    if (name === this.current) return;
    this.current = name;
    console.log("[声音] 背景音乐 →", name, this.muted ? "（静音中）" : "", this.hidden ? "（后台）" : "");
    for (const [n, t] of this.tracks) {
      t.target = n === name ? MUSIC_VOL : 0;
      // 不淡入淡出的平台：别的曲子马上停
      if (!this.fades && n !== name && t.playing) { try { t.voice.pause(); } catch { /* 忽略 */ } t.playing = false; }
    }
    if (!name) return;
    let t = this.tracks.get(name);
    if (!t) {
      const voice = this.host.makeMusicVoice ? this.host.makeMusicVoice() : this.host.makeVoice();
      voice.src = this.host.url(`bgm_${name}`);
      voice.loop = true;
      t = { voice, vol: this.fades ? 0 : MUSIC_VOL, target: MUSIC_VOL, playing: false };
      voice.volume = t.vol;
      this.tracks.set(name, t);
    }
    t.target = MUSIC_VOL;
    this.ensurePlaying(t);
  }

  private ensurePlaying(t: Track): void {
    if (this.muted || this.hidden || t.playing) return;
    try {
      if (!this.fades) { t.vol = t.target; t.voice.volume = t.vol; } // 开播前把音量定好
      t.playing = true;
      void Promise.resolve(t.voice.play()).catch(() => { t.playing = false; });
    } catch { t.playing = false; }
  }

  /** 每帧调用：音乐淡入淡出（不淡的平台只负责“该放没在放就补放”） */
  update(dt: number): void {
    this.clock += dt;
    for (const t of this.tracks.values()) {
      const goal = this.muted ? 0 : t.target;
      if (!this.fades) {
        if (goal > 0) this.ensurePlaying(t);
        continue;
      }
      const step = (MUSIC_VOL / FADE_S) * dt;
      const before = t.vol;
      t.vol = t.vol < goal ? Math.min(goal, t.vol + step) : Math.max(goal, t.vol - step);
      if (t.vol <= 0.001 && t.playing && goal === 0) { t.voice.pause(); t.playing = false; }
      if (goal > 0) this.ensurePlaying(t);
      if (Math.abs(t.vol - before) > 1e-4) try { t.voice.volume = t.vol; } catch { /* 忽略 */ }
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.host.storageSet(MUTE_KEY, m ? "1" : "0");
    if (m) {
      for (const v of this.pool) try { v.stop(); } catch { /* 忽略 */ }
      if (!this.fades) for (const t of this.tracks.values()) { try { t.voice.pause(); } catch { /* 忽略 */ } t.playing = false; }
    }
  }

  /** 切到后台：音乐先停；回来再接着放 */
  setHidden(h: boolean): void {
    this.hidden = h;
    if (h) for (const t of this.tracks.values()) { try { t.voice.pause(); } catch { /* 忽略 */ } t.playing = false; }
  }
}
