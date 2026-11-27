/**
 * 启动画面：程序化远山（不需要任何资源文件，开机就能画）+ 标题印章 + 进度条 + 百分比 + 状态 + 轮换的玩法小贴士。
 * 小游戏分两段：下载分包（约 19MB，第一次才有）→ 解码精灵；调用方用 set(进度 0..1, 状态文字) 推进。
 * 加载期间自己每 0.4 秒重画一次（贴士轮换、进度条缓动），done() 后停。
 */
import type { Platform } from "../platform/platform";
import { drawBackdropLayers, paintBackdropLayers, type BackdropLayer } from "../render/backdrop";
import { COLORS, FONT, KAI, font, roundRect } from "./ui";

const TIPS = [
  "白天开荒种田、攒钱，天黑前记得修补篱笆",
  "修好青瓦正房就能迎娶阿莲，夜里她会熬汤回血",
  "孩子长成少年那天在做什么，就定了他驻守时的羁绊",
  "敌人沿土路进山，竹箭楼放在路边最管用",
  "捕兽夹专克野兽，打完一夜记得补夹子",
  "货郎进山的那天，把多余的粮和木卖掉换钱",
  "单指拖动看地图，双指缩放看细节",
  "第三夜黑熊王来袭，提前多备几座箭楼",
];

export class LoadingScreen {
  private bg: BackdropLayer[] | null = null;
  private frac = 0;
  private shown = 0;
  private msg = "进山中…";
  private failed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly t0 = Date.now();

  constructor(private readonly platform: Platform) {
    this.timer = setInterval(() => this.draw(), 400);
  }

  set(frac: number, msg?: string): void {
    this.frac = Math.max(this.frac, Math.min(1, frac));
    if (msg) this.msg = msg;
    this.failed = false;
    this.draw();
  }

  /** 失败：进度条变红、显示原因（比如“下载没成功，点屏幕重试”） */
  fail(msg: string): void {
    this.failed = true;
    this.msg = msg;
    this.draw();
  }

  done(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private draw(): void {
    const p = this.platform;
    const canvas = p.mainCanvas();
    const ctx = canvas.getContext("2d")!;
    const dpr = p.pixelRatio();
    const { w, h } = p.screenSize();
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    // 远山（只画一次，缓存）
    if (!this.bg) {
      try { this.bg = paintBackdropLayers((cw, ch) => p.createOffscreen(cw, ch), w, h, false, 5, "aged", Math.min(dpr, 1.5)); } catch { this.bg = []; }
    }
    ctx.fillStyle = "#d9cba6";
    ctx.fillRect(0, 0, w, h);
    if (this.bg.length) drawBackdropLayers(ctx, this.bg, w, h, 0, 0, 1);
    // 一层薄绢，让字更清楚
    ctx.fillStyle = "rgba(233,223,198,0.45)";
    ctx.fillRect(0, 0, w, h);

    const cy = h * 0.42;
    // 标题四字 + 朱砂印
    ctx.fillStyle = COLORS.ink; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `700 46px ${KAI}`;
    const chars = ["深", "山", "传", "家"], offs = [0, 6, 0, -4];
    chars.forEach((t, k) => ctx.fillText(t, w / 2 - 14 + (k - 1.5) * 50, cy - 40 + offs[k]!));
    ctx.save();
    ctx.translate(w / 2 + 100, cy - 58); ctx.rotate((-6 * Math.PI) / 180);
    roundRect(ctx, -20, -20, 40, 40, 4); ctx.fillStyle = COLORS.cinnabar; ctx.fill();
    ctx.font = `13px ${KAI}`; ctx.fillStyle = COLORS.toastText; ctx.fillText("开荒", 0, -8); ctx.fillText("守寨", 0, 9);
    ctx.restore();

    // 进度条（显示值往目标值缓动，下载事件稀疏时也平滑）
    this.shown += (this.frac - this.shown) * 0.5;
    if (Math.abs(this.frac - this.shown) < 0.002) this.shown = this.frac;
    const bw = Math.min(260, w * 0.66), bx = w / 2 - bw / 2, by = cy + 22, bh = 10;
    roundRect(ctx, bx - 2, by - 2, bw + 4, bh + 4, 7); ctx.fillStyle = "rgba(28,21,16,0.25)"; ctx.fill();
    roundRect(ctx, bx, by, bw, bh, 5); ctx.fillStyle = COLORS.hpBack; ctx.fill();
    if (this.shown > 0.004) {
      roundRect(ctx, bx, by, Math.max(bh, bw * this.shown), bh, 5);
      ctx.fillStyle = this.failed ? "#8e2a20" : COLORS.cinnabar; ctx.fill();
    }
    roundRect(ctx, bx, by, bw, bh, 5); ctx.lineWidth = 1.2; ctx.strokeStyle = COLORS.ink; ctx.stroke();
    ctx.font = font(12, true); ctx.fillStyle = COLORS.ink;
    ctx.fillText(`${Math.round(this.shown * 100)}%`, w / 2, by + bh + 16);
    ctx.font = font(12); ctx.globalAlpha = 0.8;
    ctx.fillText(this.msg, w / 2, by + bh + 34);
    ctx.globalAlpha = 1;

    // 小贴士（每 3 秒换一条）
    const tip = TIPS[Math.floor((Date.now() - this.t0) / 3000) % TIPS.length]!;
    ctx.font = `13px ${FONT}`;
    const tw = Math.min(w - 40, ctx.measureText(tip).width + 30);
    roundRect(ctx, w / 2 - tw / 2, h * 0.78 - 16, tw, 32, 16);
    ctx.fillStyle = "rgba(28,21,16,0.72)"; ctx.fill();
    ctx.fillStyle = COLORS.toastText;
    ctx.fillText(tip, w / 2, h * 0.78 + 0.5);

    // 健康游戏忠告（游戏上线惯例：启动画面底部显示）
    const bottom = h - Math.max(10, p.safeInsets().bottom) - 6;
    ctx.globalAlpha = 0.7; ctx.fillStyle = COLORS.ink;
    ctx.font = font(10, true);
    ctx.fillText("健康游戏忠告", w / 2, bottom - 28);
    ctx.font = font(10);
    ctx.fillText("抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。", w / 2, bottom - 14);
    ctx.fillText("适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。", w / 2, bottom);
    ctx.globalAlpha = 1;
  }
}
