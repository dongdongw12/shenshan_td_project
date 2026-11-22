/**
 * Canvas2D 等距昼夜渲染器。
 * 每帧顺序：天色底 → 地块（昼夜插值）→ 全部地影（单独一层）→ 按遮挡排序画物体（白昼图 + 逐户点灯的夜晚图）。
 * 只用微信小游戏同样支持的 Canvas2D 子集。
 */
import { depthSort } from "./depthSort";
import { hexToRgb, lightAlpha, mixRgb, shadowOpacity, type RGB } from "./dayNight";
import { IsoProjection, type Vec2 } from "./iso";
import type { Scene, SpriteObject } from "./scene";
import type { GroundTexture } from "./groundPainter";
import type { ImageLike } from "../platform/platform";

export interface SpriteImages {
  day: ImageLike;
  night: ImageLike;
  shadow?: ImageLike;
}

export interface Camera {
  /** 世界原点在屏幕上的位置（逻辑像素） */
  x: number;
  y: number;
  zoom: number;
}

export interface GroundPalette {
  sky: [string, string];
  tileA: [string, string];
  tileB: [string, string];
  grid: [string, string];
}

/** 与 docs/art/ART_BIBLE.md 色板一致：白昼青绿土地，夜晚夜靛 */
export const DEFAULT_GROUND: GroundPalette = {
  sky: ["#cdd8cf", "#0f1528"],
  tileA: ["#9fac7a", "#232b44"],
  tileB: ["#97a473", "#1f2740"],
  grid: ["#76825a", "#171d33"],
};

export interface RenderOptions {
  /** 绘制好的地面贴图（白昼 / 夜晚），没有就画纯色地块 */
  ground?: { day: GroundTexture; night: GroundTexture };
  /** 宣纸纹理（屏幕固定平铺） */
  paper?: HTMLCanvasElement;
  paperAlpha?: number;
  /** 格线（建造模式时打开） */
  showGrid?: boolean;
  /** 贴地图层（农田、鱼梁、选址预览等）：画在地影之后、物体之前，不参与遮挡排序 */
  drawDecals?: (ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number, z?: number) => Vec2, pxPerMeter: number) => void;
  /** 背景（远山等，屏幕固定）：画在天色之后、地面之前 */
  drawBackdrop?: (ctx: CanvasRenderingContext2D, w: number, h: number, nightAlpha: number) => void;
  /** 最上层（飘字、血条等），不参与排序 */
  drawOverlay?: (ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number, z?: number) => Vec2, pxPerMeter: number) => void;
}

export interface FrameStats {
  drawn: number;
  culled: number;
  sortMs: number;
}

export class IsoRenderer {
  private readonly ground: { [K in keyof GroundPalette]: [RGB, RGB] };

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    readonly iso: IsoProjection,
    private readonly images: Map<string, SpriteImages>,
    ground: GroundPalette = DEFAULT_GROUND,
  ) {
    const conv = (p: [string, string]): [RGB, RGB] => [hexToRgb(p[0]), hexToRgb(p[1])];
    this.ground = { sky: conv(ground.sky), tileA: conv(ground.tileA), tileB: conv(ground.tileB), grid: conv(ground.grid) };
  }

  private toScreen(world: Vec2, cam: Camera): Vec2 {
    const s = this.iso.worldToScreen(world);
    return { x: cam.x + s.x * cam.zoom, y: cam.y + s.y * cam.zoom };
  }

  private paperPattern: CanvasPattern | null = null;
  private paperSrc: HTMLCanvasElement | null = null;

  render(scene: Scene, cam: Camera, nightAlpha: number, viewport: { w: number; h: number; dpr: number }, opts: RenderOptions = {}): FrameStats {
    const ctx = this.ctx;
    const { w, h, dpr } = viewport;
    const a = nightAlpha;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = 1;
    ctx.fillStyle = mixRgb(this.ground.sky[0], this.ground.sky[1], a);
    ctx.fillRect(0, 0, w, h);
    if (opts.drawBackdrop) { opts.drawBackdrop(ctx, w, h, a); ctx.globalAlpha = 1; }

    if (opts.ground) {
      this.drawGroundTexture(opts.ground.day, cam, 1);
      if (a > 0.002) this.drawGroundTexture(opts.ground.night, cam, a);
      if (opts.showGrid) this.drawGrid(scene, cam, a);
    } else {
      this.drawGround(scene, cam, a, w, h);
      this.drawGrid(scene, cam, a);
    }

    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    const ordered = depthSort(scene.sortables());
    const sortMs = (typeof performance !== "undefined" ? performance.now() : 0) - t0;

    // 地影层：先画全部，近处物体的影子不会盖到远处建筑上
    let drawn = 0, culled = 0;
    for (const s of ordered) {
      if (s.obj.kind !== "sprite") continue;
      const img = this.images.get(s.obj.stem);
      const meta = scene.atlas.sprites[s.obj.stem]!;
      if (!img?.shadow) continue;
      const r = this.spriteRect(scene, s.obj, cam);
      if (!this.visible(r, w, h)) continue;
      ctx.globalAlpha = shadowOpacity(a, meta.night_shadow_opacity ?? 0.6);
      ctx.drawImage(img.shadow, r.x, r.y, r.w, r.h);
    }

    const toScreen = (x: number, y: number, z = 0) => {
      const p = this.iso.worldToScreen({ x, y, z });
      return { x: cam.x + p.x * cam.zoom, y: cam.y + p.y * cam.zoom };
    };
    const ppmScreen = this.iso.cfg.pxPerMeter * cam.zoom;
    if (opts.drawDecals) { ctx.globalAlpha = 1; opts.drawDecals(ctx, toScreen, ppmScreen); }

    for (const s of ordered) {
      const o = s.obj;
      if (o.kind === "custom") {
        ctx.globalAlpha = 1;
        const p = this.iso.worldToScreen(o.pos);
        o.draw(ctx, { x: cam.x + p.x * cam.zoom, y: cam.y + p.y * cam.zoom }, this.iso.cfg.pxPerMeter * cam.zoom, a);
        drawn++;
        continue;
      }
      const img = this.images.get(o.stem);
      if (!img) continue;
      const r = this.spriteRect(scene, o, cam);
      if (!this.visible(r, w, h)) { culled++; continue; }
      ctx.globalAlpha = 1;
      ctx.drawImage(img.day, r.x, r.y, r.w, r.h);
      const la = lightAlpha(a, o.lightDelay);
      if (la > 0.002) {
        ctx.globalAlpha = la;
        ctx.drawImage(img.night, r.x, r.y, r.w, r.h);
      }
      drawn++;
    }
    if (opts.drawOverlay) { ctx.globalAlpha = 1; opts.drawOverlay(ctx, toScreen, ppmScreen); }
    if (opts.paper) {
      if (this.paperSrc !== opts.paper) {
        this.paperPattern = ctx.createPattern(opts.paper, "repeat");
        this.paperSrc = opts.paper;
      }
      if (this.paperPattern) {
        // 宣纸纹理里有浅色纤维，夜里在深底上会像雪点，随夜色减淡
        ctx.globalAlpha = (opts.paperAlpha ?? 0.9) * (1 - 0.75 * a);
        ctx.fillStyle = this.paperPattern;
        ctx.fillRect(0, 0, w, h);
      }
    }
    ctx.globalAlpha = 1;
    return { drawn, culled, sortMs };
  }

  private drawGroundTexture(tex: GroundTexture, cam: Camera, alpha: number): void {
    const k = cam.zoom * (this.iso.cfg.pxPerMeter / tex.pxPerMeter);
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(tex.canvas, cam.x - tex.origin.x * k, cam.y - tex.origin.y * k, tex.canvas.width * k, tex.canvas.height * k);
    this.ctx.globalAlpha = 1;
  }

  spriteRect(scene: Scene, o: SpriteObject, cam: Camera): { x: number; y: number; w: number; h: number } {
    const meta = scene.atlas.sprites[o.stem]!;
    const anchor = this.toScreen(scene.anchorWorld(o), cam);
    const k = cam.zoom * (this.iso.cfg.pxPerMeter / meta.px_per_meter);
    return {
      x: anchor.x - meta.anchor_px[0] * k,
      y: anchor.y - meta.anchor_px[1] * k,
      w: meta.resolution[0] * k,
      h: meta.resolution[1] * k,
    };
  }

  private visible(r: { x: number; y: number; w: number; h: number }, w: number, h: number): boolean {
    return r.x + r.w >= 0 && r.y + r.h >= 0 && r.x <= w && r.y <= h;
  }

  private drawGround(scene: Scene, cam: Camera, a: number, w: number, h: number): void {
    const ctx = this.ctx;
    const g = this.ground;
    const colA = mixRgb(g.tileA[0], g.tileA[1], a);
    const colB = mixRgb(g.tileB[0], g.tileB[1], a);
    for (let i = 0; i < scene.cols; i++) {
      for (let j = 0; j < scene.rows; j++) {
        const pts = this.iso.tileCorners(i, j).map((p) => ({ x: cam.x + p.x * cam.zoom, y: cam.y + p.y * cam.zoom }));
        const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
        const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
        if (maxX < 0 || maxY < 0 || minX > w || minY > h) continue;
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let k = 1; k < 4; k++) ctx.lineTo(pts[k]!.x, pts[k]!.y);
        ctx.closePath();
        ctx.fillStyle = (i + j) % 2 ? colB : colA;
        ctx.fill();
      }
    }
  }

  private drawGrid(scene: Scene, cam: Camera, a: number): void {
    const ctx = this.ctx;
    const g = this.ground;
    // 细格线：沿两组轴各画一遍长线，比逐格描边省
    ctx.strokeStyle = mixRgb(g.grid[0], g.grid[1], a);
    ctx.lineWidth = Math.max(0.5, cam.zoom * 0.8);
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    const t = scene.tileSize;
    for (let i = 0; i <= scene.cols; i++) {
      const p0 = this.toScreen({ x: i * t, y: 0 }, cam), p1 = this.toScreen({ x: i * t, y: scene.rows * t }, cam);
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
    }
    for (let j = 0; j <= scene.rows; j++) {
      const p0 = this.toScreen({ x: 0, y: j * t }, cam), p1 = this.toScreen({ x: scene.cols * t, y: j * t }, cam);
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
