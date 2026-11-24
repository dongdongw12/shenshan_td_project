/**
 * 地面绘制：把整张地图的地面一次性画进离屏贴图（白昼 / 夜晚各一张），渲染时整张贴上去交叉淡入。
 * 画风与精灵一致（docs/art/ART_BIBLE.md）：矿物色平涂 + 墨线点景，不做照片质感。
 *   草地 g：石绿平涂 + 色块斑驳 + 墨色/松青草簇（三笔“个”字）
 *   土路 d：浅赭平涂 + 赭石碎点 + 路沿墨线（只画在与非土路相邻的边上）
 *   水田 f：青苗绿 + 沿 X 方向的秧行 + 田埂（赭色宽线 + 墨线细边）
 *   溪水 w：石青平涂 + 木刻水纹（成排小弧线）+ 岸边墨线与卵石
 *   山石 r：青石灰 + 皴擦短线
 * 地图外缘做“分染”式压暗，地图外透明（天色由渲染器提供）。
 * 只用 Canvas2D 通用子集（path / fill / stroke / gradient），微信小游戏同样可用。
 */
import { IsoProjection, type Vec2 } from "./iso";

export type Terrain = "g" | "d" | "f" | "w" | "r";

export interface GroundMap {
  cols: number;
  rows: number;
  /** terrain[j][i]，j 为行（世界 Y），i 为列（世界 X） */
  terrain: Terrain[][];
}

/** 用字符串描述地图：每行一个 j，从 j = 0 开始；字符 g/d/f/w/r */
export function parseGroundMap(lines: string[]): GroundMap {
  const rows = lines.length;
  const cols = Math.max(...lines.map((l) => l.length));
  const terrain = lines.map((l) => Array.from({ length: cols }, (_, i) => ((l[i] ?? "g") as Terrain)));
  return { cols, rows, terrain };
}

export interface GroundTexture {
  canvas: HTMLCanvasElement;
  /** 世界原点在贴图里的像素位置 */
  origin: Vec2;
  /** 贴图每米像素数 */
  pxPerMeter: number;
}

interface Palette {
  grass: string; grassLight: string; grassDark: string;
  dirt: string; dirtDark: string;
  field: string; fieldRow: string; ridge: string;
  water: string; waterLight: string; waterDeep: string;
  rock: string; rockDark: string;
  ink: string; inkAlpha: number;
  edge: string; sky: string;
  /** 青绿山石：山顶石青 → 山腰石绿 → 山脚赭石 */
  peakTop: string; peakMid: string; peakBase: string; moss: string;
}

const DAY: Palette = {
  grass: "#8fa267", grassLight: "#a3b47a", grassDark: "#6f8550",
  dirt: "#c9a878", dirtDark: "#9a7448",
  field: "#93ae5e", fieldRow: "#5f7f3c", ridge: "#b08a5a",
  water: "#5d8fb6", waterLight: "#d4e6ee", waterDeep: "#3f6f98",
  rock: "#8b9592", rockDark: "#5f6b6a",
  ink: "#1c1510", inkAlpha: 0.55,
  edge: "#3b4a2c", sky: "#cdd8cf",
  peakTop: "#4f7fa8", peakMid: "#5f9a6e", peakBase: "#a07a50", moss: "#24574a",
};

const NIGHT: Palette = {
  grass: "#26304a", grassLight: "#2e3954", grassDark: "#1d2540",
  dirt: "#3a3d55", dirtDark: "#2a2b40",
  field: "#25324a", fieldRow: "#1a2440", ridge: "#383650",
  water: "#1f3462", waterLight: "#7f9ed6", waterDeep: "#162650",
  rock: "#343c55", rockDark: "#232a40",
  ink: "#0b0a10", inkAlpha: 0.6,
  edge: "#080b18", sky: "#0f1528",
  peakTop: "#2a3c66", peakMid: "#223a44", peakBase: "#3a3442", moss: "#121c2c",
};

/** 古旧绢本设色：矿物色褪色、整体偏暖黄（青绿 → 灰青绿，草地 → 橄榄赭，水 → 灰石青），夜晚少一点蓝紫 */
const AGED_DAY: Palette = {
  grass: "#a3a273", grassLight: "#b4b288", grassDark: "#86865e",
  dirt: "#c7ad82", dirtDark: "#9a7b52",
  field: "#a2a768", fieldRow: "#6f7a45", ridge: "#a88a5e",
  water: "#7e9aa0", waterLight: "#dcd9c4", waterDeep: "#5d7b85",
  rock: "#9a988a", rockDark: "#6d6c62",
  ink: "#2a1d13", inkAlpha: 0.55,
  edge: "#4a4a33", sky: "#d9cba6",
  peakTop: "#5e7a87", peakMid: "#6f8c6c", peakBase: "#a48460", moss: "#3b5244",
};

const AGED_NIGHT: Palette = {
  grass: "#2a2d3c", grassLight: "#323546", grassDark: "#212433",
  dirt: "#3b3a48", dirtDark: "#2b2a36",
  field: "#283040", fieldRow: "#1c2232", ridge: "#3a3644",
  water: "#25344e", waterLight: "#8396b4", waterDeep: "#1a2740",
  rock: "#373b4a", rockDark: "#262a37",
  ink: "#0d0b0c", inkAlpha: 0.6,
  edge: "#0a0c14", sky: "#14161f",
  peakTop: "#2f3c58", peakMid: "#273a40", peakBase: "#3c3640", moss: "#151c26",
};

/** 画风主题：qinglv = 青绿重彩（原样）；aged = 古旧绢本设色（更“中国画”、更有历史感） */
export type ThemeId = "qinglv" | "aged";
const PALETTES: Record<ThemeId, { day: Palette; night: Palette }> = {
  qinglv: { day: DAY, night: NIGHT },
  aged: { day: AGED_DAY, night: AGED_NIGHT },
};
/** 渲染器的天色（白昼 / 夜晚），与地面主题配套 */
export const THEME_SKY: Record<ThemeId, [string, string]> = { qinglv: ["#cdd8cf", "#0f1528"], aged: ["#d9cba6", "#14161f"] };

/** 可复现的伪随机（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function textureBounds(iso: IsoProjection, map: GroundMap, marginPx: number): { w: number; h: number; origin: Vec2 } {
  const t = iso.cfg.tileSize;
  const pts = [
    iso.worldToScreen({ x: 0, y: 0 }), iso.worldToScreen({ x: map.cols * t, y: 0 }),
    iso.worldToScreen({ x: 0, y: map.rows * t }), iso.worldToScreen({ x: map.cols * t, y: map.rows * t }),
  ];
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  return {
    w: Math.ceil(maxX - minX + 2 * marginPx),
    h: Math.ceil(maxY - minY + 2 * marginPx),
    origin: { x: marginPx - minX, y: marginPx - minY },
  };
}

export function paintGround(
  createCanvas: (w: number, h: number) => HTMLCanvasElement,
  map: GroundMap,
  pxPerMeter: number,
  night: boolean,
  seed = 20261123,
  tileSize = 2,
  theme: ThemeId = "qinglv",
): GroundTexture {
  const iso = new IsoProjection({ pxPerMeter, tileSize, elevationDeg: 30 });
  const pal = night ? PALETTES[theme].night : PALETTES[theme].day;
  const margin = Math.round(pxPerMeter * 4); // 留够空间给向上画的山峰
  const b = textureBounds(iso, map, margin);
  const canvas = createCanvas(b.w, b.h);
  const ctx = canvas.getContext("2d")!;
  const o = b.origin;
  const S = (x: number, y: number): Vec2 => {
    const p = iso.worldToScreen({ x, y });
    return { x: o.x + p.x, y: o.y + p.y };
  };
  const px = pxPerMeter / 64; // 线宽等以 64 px/m（开发台/图集比例）为基准
  const T = tileSize;
  const at = (i: number, j: number): Terrain | null =>
    i < 0 || j < 0 || i >= map.cols || j >= map.rows ? null : map.terrain[j]![i]!;

  const poly = (pts: Vec2[]) => {
    ctx.beginPath();
    pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  };
  const tilePoly = (i: number, j: number, inset = 0) =>
    poly([S(i * T + inset, j * T + inset), S(i * T + inset, (j + 1) * T - inset), S((i + 1) * T - inset, (j + 1) * T - inset), S((i + 1) * T - inset, j * T + inset)]);

  // 1) 地图以外保持透明：天色由渲染器底色提供（贴图自带天色会在边缘露出昼夜两张贴图的接缝）
  ctx.clearRect(0, 0, b.w, b.h);

  // 2) 平涂底色
  const base: Record<Terrain, string> = { g: pal.grass, d: pal.dirt, f: pal.field, w: pal.water, r: pal.rock };
  for (let j = 0; j < map.rows; j++) {
    for (let i = 0; i < map.cols; i++) {
      tilePoly(i, j, -0.02); // 略微外扩，避免格缝
      ctx.fillStyle = base[at(i, j)!];
      ctx.fill();
    }
  }

  // 3) 斑驳色块（像矿物颜料没调匀的笔触）
  const R = rng(seed);
  for (let j = 0; j < map.rows; j++) {
    for (let i = 0; i < map.cols; i++) {
      const tt = at(i, j)!;
      const tint = tt === "g" ? [pal.grassLight, pal.grassDark] : tt === "d" ? [pal.dirt, pal.dirtDark]
        : tt === "w" ? [pal.waterDeep, pal.water] : tt === "r" ? [pal.rockDark, pal.rock] : [pal.fieldRow, pal.field];
      for (let k = 0; k < 4; k++) {
        const c = S((i + R()) * T, (j + R()) * T);
        ctx.globalAlpha = 0.12 + 0.1 * R();
        ctx.fillStyle = tint[k % 2]!;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, (10 + 18 * R()) * px, (5 + 8 * R()) * px, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;

  // 4) 各地形点景
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let j = 0; j < map.rows; j++) {
    for (let i = 0; i < map.cols; i++) {
      const tt = at(i, j)!;
      if (tt === "g") drawGrassTufts(i, j);
      else if (tt === "d") drawDirt(i, j);
      else if (tt === "f") drawField(i, j);
      else if (tt === "w") drawWater(i, j);
      else drawRock(i, j);
    }
  }

  // 5) 不同地形交界的边线（路沿、田埂、河岸）
  for (let j = 0; j < map.rows; j++) {
    for (let i = 0; i < map.cols; i++) {
      const tt = at(i, j)!;
      if (tt === "g") continue;
      // 四条边：-x、+x、-y、+y
      const edges: [number, number, Vec2, Vec2][] = [
        [i - 1, j, { x: i * T, y: j * T }, { x: i * T, y: (j + 1) * T }],
        [i + 1, j, { x: (i + 1) * T, y: j * T }, { x: (i + 1) * T, y: (j + 1) * T }],
        [i, j - 1, { x: i * T, y: j * T }, { x: (i + 1) * T, y: j * T }],
        [i, j + 1, { x: i * T, y: (j + 1) * T }, { x: (i + 1) * T, y: (j + 1) * T }],
      ];
      for (const [ni, nj, a, c] of edges) {
        const nt = at(ni, nj);
        if (nt === tt || nt === null) continue;
        if (tt === "f") ridgeLine(a, c);
        else inkEdge(a, c, tt === "w" ? 1.6 : 1.1, tt === "w");
      }
    }
  }

  // 6) 地图外缘分染：沿四边向内压暗
  edgeWash();

  // 7) 青绿山石：山石格上画层叠的石峰（由远到近画，近处压住远处）；靠谷地一侧矮、往外越来越高
  paintPeaks();

  return { canvas, origin: o, pxPerMeter };

  // ---------------------------------------------------------------- 笔触
  function drawGrassTufts(i: number, j: number) {
    const n = 5 + Math.floor(R() * 4);
    for (let k = 0; k < n; k++) {
      const p = S((i + 0.1 + 0.8 * R()) * T, (j + 0.1 + 0.8 * R()) * T);
      const h = (4 + 4 * R()) * px;
      const ink = R() < 0.55;
      ctx.strokeStyle = ink ? pal.ink : pal.grassDark;
      ctx.globalAlpha = ink ? pal.inkAlpha * 0.75 : 0.85;
      ctx.lineWidth = (ink ? 0.9 : 1.3) * px;
      ctx.beginPath();
      for (const ang of [-0.5, 0, 0.45]) {
        const ex = p.x + Math.sin(ang) * h * 0.8, ey = p.y - Math.cos(ang) * h;
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(p.x + Math.sin(ang) * h * 0.2, p.y - h * 0.5, ex, ey);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawDirt(i: number, j: number) {
    ctx.fillStyle = pal.dirtDark;
    for (let k = 0; k < 14; k++) {
      const p = S((i + R()) * T, (j + R()) * T);
      ctx.globalAlpha = 0.25 + 0.35 * R();
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, (0.8 + 1.6 * R()) * px, (0.5 + 0.9 * R()) * px, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 车辙：两道沿路向的淡线
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = pal.dirtDark;
    ctx.lineWidth = 1.4 * px;
    const alongX = at(i - 1, j) === "d" || at(i + 1, j) === "d";
    ctx.beginPath();
    for (const f of [0.38, 0.62]) {
      const a = alongX ? S(i * T, (j + f) * T) : S((i + f) * T, j * T);
      const c = alongX ? S((i + 1) * T, (j + f) * T) : S((i + f) * T, (j + 1) * T);
      ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawField(i: number, j: number) {
    ctx.strokeStyle = pal.fieldRow;
    ctx.lineWidth = 1.2 * px;
    ctx.globalAlpha = 0.75;
    for (let r = 1; r < 5; r++) {
      const y = (j + r / 5) * T;
      // 秧苗：一行短竖笔
      for (let s = 0; s < 9; s++) {
        const p = S((i + (s + 0.5 + 0.2 * (R() - 0.5)) / 9) * T, y);
        ctx.beginPath();
        ctx.moveTo(p.x - 1.2 * px, p.y);
        ctx.lineTo(p.x, p.y - 4 * px);
        ctx.moveTo(p.x + 1.2 * px, p.y);
        ctx.lineTo(p.x, p.y - 4 * px);
        ctx.stroke();
      }
    }
    // 田里的水光
    ctx.globalAlpha = night ? 0.25 : 0.18;
    ctx.fillStyle = pal.waterLight;
    for (let k = 0; k < 2; k++) {
      const p = S((i + 0.2 + 0.6 * R()) * T, (j + 0.2 + 0.6 * R()) * T);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 9 * px, 3 * px, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawWater(i: number, j: number) {
    // 木刻水纹：错落的小弧线，一排排
    ctx.strokeStyle = pal.waterLight;
    ctx.lineWidth = 1.1 * px;
    for (let r = 0; r < 4; r++) {
      for (let s = 0; s < 3; s++) {
        const p = S((i + (s + 0.5 + (r % 2) * 0.5) / 3.2) * T, (j + (r + 0.6) / 4.4) * T);
        ctx.globalAlpha = 0.55 + 0.3 * R();
        const w = (7 + 4 * R()) * px;
        ctx.beginPath();
        ctx.arc(p.x, p.y + w * 0.5, w * 0.6, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawRock(i: number, j: number) {
    ctx.strokeStyle = pal.rockDark;
    ctx.lineWidth = 1.2 * px;
    ctx.globalAlpha = 0.7;
    for (let k = 0; k < 7; k++) {
      const p = S((i + R()) * T, (j + R()) * T);
      const l = (4 + 5 * R()) * px;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + l, p.y - l * 0.35);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function paintPeaks() {
    const rocks: { i: number; j: number; inner: number }[] = [];
    for (let j = 0; j < map.rows; j++) for (let i = 0; i < map.cols; i++) {
      if (at(i, j) !== "r") continue;
      // 离谷地多远（周围 2 格内非山石格越少越“深”）
      let open = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const t2 = at(i + di, j + dj); if (t2 !== null && t2 !== "r") open++; }
      rocks.push({ i, j, inner: Math.max(0, 1 - open / 8) });
    }
    rocks.sort((a, b) => (a.i - a.j) - (b.i - b.j)); // 深度 x−y 从远到近
    const kz = iso.kz, kx = iso.kx;
    for (const r of rocks) {
      if (R() > 0.85) continue;
      const cx = (r.i + 0.5 + (R() - 0.5) * 0.4) * T, cy = (r.j + 0.5 + (R() - 0.5) * 0.4) * T;
      const base = S(cx, cy);
      const bw = (0.75 + 0.35 * R()) * T * kx;              // 半个底宽（像素）
      const h = (0.85 + r.inner * (2.4 + 1.6 * R())) * T * kz; // 峰高（像素）
      const peakX = base.x + (R() - 0.5) * bw * 0.5;
      // 轮廓：左山脚 → 锯齿上坡 → 峰顶 → 锯齿下坡 → 右山脚 → 底边微弧
      const pts: Vec2[] = [{ x: base.x - bw, y: base.y }];
      const steps = 4;
      for (let k = 1; k <= steps; k++) {
        const t = k / (steps + 1);
        pts.push({ x: base.x - bw + (peakX - base.x + bw) * t + (R() - 0.5) * bw * 0.12, y: base.y - h * (t ** 0.8) + (k % 2 ? h * 0.08 : 0) });
      }
      pts.push({ x: peakX, y: base.y - h });
      for (let k = steps; k >= 1; k--) {
        const t = k / (steps + 1);
        pts.push({ x: base.x + bw - (base.x + bw - peakX) * t + (R() - 0.5) * bw * 0.12, y: base.y - h * (t ** 0.9) + (k % 2 ? 0 : h * 0.07) });
      }
      pts.push({ x: base.x + bw, y: base.y });
      ctx.beginPath();
      pts.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.quadraticCurveTo(base.x, base.y + bw * 0.28, base.x - bw, base.y);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, base.y - h, 0, base.y + bw * 0.2);
      grad.addColorStop(0, pal.peakTop);
      grad.addColorStop(0.55, pal.peakMid);
      grad.addColorStop(1, pal.peakBase);
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = pal.ink;
      ctx.globalAlpha = pal.inkAlpha + 0.15;
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      // 皴：沿山坡的短钩笔
      ctx.lineWidth = 1.0 * px;
      ctx.globalAlpha = pal.inkAlpha * 0.6;
      for (let k = 0; k < 3 + Math.floor(R() * 4); k++) {
        const t = 0.2 + 0.6 * R();
        const sx = base.x - bw * 0.6 + bw * 1.2 * R(), sy = base.y - h * t;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + bw * 0.12, sy + h * 0.06, sx + bw * 0.08, sy + h * 0.16);
        ctx.stroke();
      }
      // 苔点
      ctx.fillStyle = pal.moss;
      ctx.globalAlpha = 0.8;
      for (let k = 0; k < 4; k++) {
        const t = R();
        const q = pts[1 + Math.floor(t * (pts.length - 2))]!;
        ctx.beginPath();
        ctx.ellipse(q.x + (R() - 0.5) * 4 * px, q.y + 2 * px, 1.6 * px, 1.1 * px, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function inkEdge(a: Vec2, c: Vec2, width: number, pebbles: boolean) {
    // 沿边的手绘墨线：分段 + 抖动 + 偶尔断笔
    const n = 7;
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = width * px;
    ctx.globalAlpha = pal.inkAlpha;
    ctx.beginPath();
    let pen = false;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const wx = a.x + (c.x - a.x) * t + (R() - 0.5) * 0.08 * T;
      const wy = a.y + (c.y - a.y) * t + (R() - 0.5) * 0.08 * T;
      const p = S(wx, wy);
      if (!pen || R() < 0.12) { ctx.moveTo(p.x, p.y); pen = true; } else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    if (pebbles) {
      ctx.fillStyle = pal.rock;
      for (let k = 0; k < 3; k++) {
        const t = R();
        const p = S(a.x + (c.x - a.x) * t + (R() - 0.5) * 0.15 * T, a.y + (c.y - a.y) * t + (R() - 0.5) * 0.15 * T);
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, (2 + 2 * R()) * px, (1.2 + R()) * px, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = pal.inkAlpha;
        ctx.lineWidth = 0.8 * px;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function ridgeLine(a: Vec2, c: Vec2) {
    const p0 = S(a.x, a.y), p1 = S(c.x, c.y);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.ridge;
    ctx.lineWidth = 3.4 * px;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    ctx.strokeStyle = pal.ink;
    ctx.globalAlpha = pal.inkAlpha * 0.8;
    ctx.lineWidth = 0.8 * px;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y + 1.7 * px); ctx.lineTo(p1.x, p1.y + 1.7 * px); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function edgeWash() {
    const W = map.cols * T, H = map.rows * T, d = 0.7 * T;
    const strips: [Vec2, Vec2, Vec2, Vec2][] = [
      [{ x: 0, y: 0 }, { x: 0, y: H }, { x: d, y: H }, { x: d, y: 0 }],      // x = 0 边
      [{ x: W, y: 0 }, { x: W, y: H }, { x: W - d, y: H }, { x: W - d, y: 0 }], // x = W 边
      [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: d }, { x: 0, y: d }],      // y = 0 边
      [{ x: 0, y: H }, { x: W, y: H }, { x: W, y: H - d }, { x: 0, y: H - d }], // y = H 边
    ];
    for (const s of strips) {
      const [e0, , , i0] = s;
      const pe = S(e0.x, e0.y), pi = S(i0.x, i0.y);
      const g = ctx.createLinearGradient(pe.x, pe.y, pi.x, pi.y);
      g.addColorStop(0, pal.edge);
      g.addColorStop(1, "rgba(0,0,0,0)");
      // 渐变方向应垂直于边：用边的起点与内侧点
      const ps = s.map((q) => S(q.x, q.y));
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = g;
      poly(ps);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 外轮廓一道淡墨线，像版画的边框
    const corners = [S(0, 0), S(0, map.rows * T), S(map.cols * T, map.rows * T), S(map.cols * T, 0)];
    ctx.strokeStyle = pal.ink;
    ctx.globalAlpha = pal.inkAlpha * 0.7;
    ctx.lineWidth = 1.4 * px;
    poly(corners);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** 宣纸纹理（小方块平铺，用 createPattern 盖满全屏）：细纤维 + 颗粒。 */
export function paintPaper(createCanvas: (w: number, h: number) => HTMLCanvasElement, size = 256, seed = 7, theme: ThemeId = "qinglv"): HTMLCanvasElement {
  const aged = theme === "aged";
  if (aged) size = Math.max(size, 512); // 旧绢的水渍斑块需要更大的平铺块，否则重复感明显
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d")!;
  const R = rng(seed);
  ctx.clearRect(0, 0, size, size);
  if (aged) {
    // 旧绢：几块极淡的暖褐水渍 + 一层很淡的暖黄底，营造年代感（叠在最上层，透明度很低）
    for (let k = 0; k < 7; k++) {
      const x = R() * size, y = R() * size, r = size * (0.12 + 0.22 * R());
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(140,104,58,0.10)");
      g.addColorStop(1, "rgba(140,104,58,0)");
      ctx.fillStyle = g;
      for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) { ctx.save(); ctx.translate(dx, dy); ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore(); }
    }
    // 绢的经纬：极细的横竖线
    ctx.lineWidth = 0.5;
    for (let k = 0; k < size; k += 3) {
      ctx.globalAlpha = 0.025 + 0.02 * R();
      ctx.strokeStyle = "#7a6040";
      ctx.beginPath(); ctx.moveTo(0, k + 0.5); ctx.lineTo(size, k + 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(k + 0.5, 0); ctx.lineTo(k + 0.5, size); ctx.stroke();
    }
  }
  for (let k = 0; k < (aged ? 3600 : 900); k++) {
    ctx.globalAlpha = 0.05 + 0.1 * R();
    ctx.fillStyle = R() < 0.5 ? (aged ? "#6b5236" : "#5a4630") : (aged ? "#f3e6c4" : "#ffffff");
    ctx.fillRect(R() * size, R() * size, 1 + R(), 1 + R());
  }
  ctx.lineWidth = 0.6;
  for (let k = 0; k < 70; k++) {
    const x = R() * size, y = R() * size, a = R() * Math.PI, l = 6 + 16 * R();
    ctx.globalAlpha = 0.06 + 0.06 * R();
    ctx.strokeStyle = "#6b5236";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (R() - 0.5) * 4, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return c;
}
