/**
 * 2:1 等距投影数学 —— 必须与 pipeline/blender/bake_isometric_sprites.py 的相机完全一致：
 *   相机俯角 30°、方位角 45°，从世界 (+X, −Y) 方向看向原点。
 *
 * 世界坐标（米，Z 向上）：
 *   +X → 屏幕右下，+Y → 屏幕右上，建筑正面（−Y）朝屏幕左下。
 * 屏幕坐标（像素，y 向下）：
 *   sx = (x + y) · cos45° · ppm
 *   sy = (x − y) · cos45° · sin(俯角) · ppm − z · cos(俯角) · ppm
 * 地块：1 格 = tileSize 米（默认 2m），格 (i, j) 覆盖 x∈[i·t,(i+1)·t]、y∈[j·t,(j+1)·t]。
 */

export interface IsoConfig {
  /** 每米像素数（母版 128；图集按缩放系数同比缩小） */
  pxPerMeter: number;
  /** 一格多少米 */
  tileSize: number;
  /** 相机俯角（度） */
  elevationDeg: number;
}

export const DEFAULT_ISO: IsoConfig = { pxPerMeter: 128, tileSize: 2, elevationDeg: 30 };

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 extends Vec2 {
  z: number;
}

const COS45 = Math.SQRT1_2;

export class IsoProjection {
  readonly cfg: IsoConfig;
  /** 世界 1m 沿 X 或 Y 在屏幕上的水平/垂直分量（像素） */
  readonly kx: number;
  readonly ky: number;
  readonly kz: number;

  constructor(cfg: Partial<IsoConfig> = {}) {
    this.cfg = { ...DEFAULT_ISO, ...cfg };
    const elev = (this.cfg.elevationDeg * Math.PI) / 180;
    this.kx = COS45 * this.cfg.pxPerMeter;
    this.ky = COS45 * Math.sin(elev) * this.cfg.pxPerMeter;
    this.kz = Math.cos(elev) * this.cfg.pxPerMeter;
  }

  /** 世界（米）→ 屏幕（像素，相对世界原点） */
  worldToScreen(p: Vec2 | Vec3): Vec2 {
    const z = "z" in p ? p.z : 0;
    return { x: (p.x + p.y) * this.kx, y: (p.x - p.y) * this.ky - z * this.kz };
  }

  /** 屏幕（像素）→ 地面上的世界坐标（z = 0） */
  screenToGround(s: Vec2): Vec2 {
    const a = s.x / this.kx; // x + y
    const b = s.y / this.ky; // x − y
    return { x: (a + b) / 2, y: (a - b) / 2 };
  }

  /** 地块中心（世界米） */
  tileCenter(i: number, j: number): Vec2 {
    const t = this.cfg.tileSize;
    return { x: (i + 0.5) * t, y: (j + 0.5) * t };
  }

  /** 屏幕点落在哪一格（向下取整） */
  screenToTile(s: Vec2): { i: number; j: number } {
    const g = this.screenToGround(s);
    return { i: Math.floor(g.x / this.cfg.tileSize), j: Math.floor(g.y / this.cfg.tileSize) };
  }

  /** 一格菱形的屏幕宽高（像素），2:1 时 高 = 宽 / 2 */
  tileDiamond(): { w: number; h: number } {
    const t = this.cfg.tileSize;
    return { w: 2 * this.kx * t, h: 2 * this.ky * t };
  }

  /** 一格菱形四个顶点（屏幕像素，顺序：左、上、右、下）。
   *  sx ∝ x+y、sy ∝ x−y：最左 (x0,y0)、最上 (x0,y1)、最右 (x1,y1)、最下 (x1,y0)。 */
  tileCorners(i: number, j: number): [Vec2, Vec2, Vec2, Vec2] {
    const t = this.cfg.tileSize;
    const x0 = i * t, x1 = (i + 1) * t, y0 = j * t, y1 = (j + 1) * t;
    return [
      this.worldToScreen({ x: x0, y: y0 }),
      this.worldToScreen({ x: x0, y: y1 }),
      this.worldToScreen({ x: x1, y: y1 }),
      this.worldToScreen({ x: x1, y: y0 }),
    ];
  }

  /** 深度值：越大越靠近相机（屏幕越靠下） */
  depthOf(p: Vec2): number {
    return p.x - p.y;
  }
}
