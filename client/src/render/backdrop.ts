/**
 * 深山远景（屏幕固定的背景，画在地面之后）：程序化“青绿山水”——
 * 五层山由远到近、由淡到深（远山灰青、中山石青石绿、近山墨绿），每座峰分阴阳两面（左上来光：左坡受光、
 * 右坡背光），背光面加披麻皴，山脊点苔、近处山头长松，层与层之间压一道云雾，中景一线瀑布，前景是压暗的松林坡。
 * 构图是“谷中”：两侧峰高、中间低，正好框住玩法地图（地图盖住画面中间，露出来的是左右上角和地图下方）。
 *
 * 分三组画在三张画布上（远 / 中 / 近），拖动地图时按不同比例平移（视差），更有纵深。
 * 几何只由 seed 决定，白昼 / 夜晚两套颜色用同一套几何，入夜交叉淡入不会错位。
 */
import type { ThemeId } from "./groundPainter";

type Ctx = CanvasRenderingContext2D;
interface Pt { x: number; y: number }

export interface BackdropLayer {
  canvas: HTMLCanvasElement;
  /** 视差系数：相机平移 dx 时这一层平移 dx × depth */
  depth: number;
  /** 画布比屏幕左右各宽出的逻辑像素（给视差留余量） */
  margin: number;
  /** 画布像素 / 逻辑像素 */
  scale: number;
  /** 画布比屏幕上下各高出的逻辑像素（竖向视差 / 缩放时不露边） */
  vpad: number;
}

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

// ------------------------------------------------------------------ 几何（只依赖 seed 和屏幕尺寸）

interface Peak {
  apex: Pt;
  foot: number;
  /** 左坡轮廓：山脚 → 山顶；右坡：山顶 → 山脚 */
  left: Pt[];
  right: Pt[];
  /** 阴阳分界（山顶 → 山脚，偏右） */
  spine: Pt[];
  /** 山头松树的位置（只有近层用） */
  trees: Pt[];
  /** 点苔 */
  moss: Pt[];
  /** 皴笔：[起点, 控制点, 终点] */
  strokes: [Pt, Pt, Pt][];
}

interface LayerGeo { idx: number; group: 0 | 1 | 2; peaks: Peak[]; foot: number; mistH: number }

interface Geo {
  w: number; h: number; margin: number;
  layers: LayerGeo[];
  clouds: { x: number; y: number; rx: number; ry: number; group: 0 | 1 }[];
  fall: { x0: number; y0: number; y1: number; width: number } | null;
  birds: Pt[];
  moon: Pt;
  stars: Pt[];
}

/** 平滑噪声（几个正弦叠加，按 seed 取相位）：给山坡轮廓加大中小三级起伏 */
function noise1(R: () => number): (t: number) => number {
  const ph = [R() * 6.28, R() * 6.28, R() * 6.28, R() * 6.28];
  return (t) => 0.5 * Math.sin(t * 5.1 + ph[0]!) + 0.28 * Math.sin(t * 11.7 + ph[1]!) + 0.14 * Math.sin(t * 27.3 + ph[2]!) + 0.08 * Math.sin(t * 61 + ph[3]!);
}

/**
 * 一座峰：半宽随高度 v（0 山脚 → 1 山顶）按“超椭圆”收拢——顶部圆浑、山脚外撇，再叠肩部隆起和三级起伏。
 * kind：0 = 高耸石峰（顶窄、两肩），1 = 浑厚山（顶圆、坡缓），2 = 前景松坡（矮、宽、圆）
 */
function makePeak(R: () => number, x: number, apexY: number, foot: number, wl: number, wr: number, kind: 0 | 1 | 2, trees: number): Peak {
  const H = foot - apexY;
  const n = kind === 0 ? 1.6 + R() * 0.8 : kind === 1 ? 2.4 + R() * 1.2 : 3 + R();
  const m = kind === 0 ? 1.15 + R() * 0.4 : 1.5 + R() * 0.6;
  const shoulderV = 0.45 + R() * 0.25, shoulder = (kind === 0 ? 0.18 : 0.1) * (0.5 + R());
  const nl = noise1(R), nr = noise1(R), ns = noise1(R);
  const rough = kind === 2 ? 0.05 : 0.09;
  const hw = (v: number) => Math.pow(Math.max(0, 1 - Math.pow(v, n)), 1 / m) + shoulder * Math.exp(-((v - shoulderV) ** 2) / 0.012);
  const N = 30;
  const left: Pt[] = [], right: Pt[] = [], spine: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    const v = k / N; // 山脚 → 山顶
    const y = foot - v * H;
    left.push({ x: x - wl * hw(v) + nl(v * 3) * H * rough * (1 - v * 0.6), y: y + Math.max(0, nl(v * 7 + 2)) * H * 0.012 });
  }
  for (let k = N; k >= 0; k--) {
    const v = k / N; // 山顶 → 山脚
    const y = foot - v * H;
    right.push({ x: x + wr * hw(v) + nr(v * 3) * H * rough * (1 - v * 0.6), y: y + Math.max(0, nr(v * 7 + 2)) * H * 0.012 });
  }
  left[N] = right[0] = { x: x + (nl(3) + nr(3)) * 0.5 * H * rough * 0.4, y: apexY };
  // 阴阳分界：从山顶斜到山脚右侧 30% 处，略带弯（山的“脊”）
  for (let k = N; k >= 0; k--) {
    const v = k / N;
    const lx = at(left, v).x, rx = at(right, 1 - v).x;
    spine.push({ x: lx + (rx - lx) * (0.5 + 0.18 * (1 - v)) + ns(v * 4) * H * 0.03, y: foot - v * H });
  }
  spine[0] = left[N]!;
  const strokes: [Pt, Pt, Pt][] = [];
  // 顺着山势的长皴：背光面 3–4 条、受光面 2 条，每条从高处顺坡下到山脚附近（体积感主要靠它）
  const along = (f: number, lit: boolean, v0: number, v1: number) => {
    const seg = 6;
    for (let k = 0; k < seg; k++) {
      const a = v0 + (v1 - v0) * (k / seg), b = v0 + (v1 - v0) * ((k + 1) / seg);
      const P = (v: number): Pt => {
        const sp = at(spine, 1 - v);
        const ed = lit ? at(left, v) : at(right, 1 - v);
        return { x: sp.x + (ed.x - sp.x) * f, y: sp.y + H * 0.01 };
      };
      const p = P(a), q = P(b);
      strokes.push([p, { x: (p.x + q.x) / 2 + (R() - 0.5) * H * 0.02, y: (p.y + q.y) / 2 }, q]);
    }
  };
  for (const f of [0.22, 0.45, 0.68, 0.86]) if (R() < 0.9) along(f, false, 0.92 - R() * 0.15, 0.08 + R() * 0.15);
  for (const f of [0.35, 0.7]) if (R() < 0.8) along(f, true, 0.85 - R() * 0.2, 0.2 + R() * 0.2);
  // 横向的岩层短皴（背光面），让石壁有“块面”
  for (let k = 0; k < Math.round(H / 18); k++) {
    const v = 0.15 + R() * 0.7;
    const sp = at(spine, 1 - v), ed = at(right, 1 - v);
    const f0 = R() * 0.5, f1 = f0 + 0.2 + R() * 0.3;
    const p = { x: sp.x + (ed.x - sp.x) * f0, y: sp.y }, q = { x: sp.x + (ed.x - sp.x) * Math.min(1, f1), y: sp.y + H * (0.02 + R() * 0.03) };
    strokes.push([p, { x: (p.x + q.x) / 2, y: p.y + H * 0.005 }, q]);
  }
  const moss: Pt[] = [];
  const outline = [...left.slice(Math.floor(N * 0.35)), ...right.slice(1, Math.ceil(N * 0.65))];
  for (const p of outline) if (R() < 0.4) moss.push({ x: p.x + (R() - 0.5) * 3, y: p.y + 1 + R() * 3 });
  for (let k = 0; k < 8; k++) { const p = at(spine, 0.05 + R() * 0.55); moss.push({ x: p.x + (R() - 0.5) * 5, y: p.y + R() * 5 }); }
  const tr: Pt[] = [];
  for (const p of outline) if (R() < trees) tr.push({ x: p.x + (R() - 0.5) * 2, y: p.y + 1.5 });
  if (kind === 2) {
    // 前景松坡：坡面上再撒一层松林
    for (let k = 0; k < 26; k++) { const v = R() * 0.75; const l = at(left, v), r = at(right, 1 - v); tr.push({ x: l.x + (r.x - l.x) * R(), y: l.y + H * (0.04 + R() * 0.1) }); }
    tr.sort((a, b) => a.y - b.y);
  }
  return { apex: left[N]!, foot, left, right, spine, trees: tr, moss, strokes };
}

/** 折线上按弧长比例 t∈[0,1] 取点 */
function at(pts: Pt[], t: number): Pt {
  const k = Math.max(0, Math.min(pts.length - 1.001, t * (pts.length - 1)));
  const i = Math.floor(k), f = k - i;
  const a = pts[i]!, b = pts[i + 1]!;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

function makeGeo(w: number, h: number, margin: number, seed: number): Geo {
  const R = rng(seed);
  const W = w + margin * 2;
  // 每层：峰顶高度（两侧 / 中间）、山脚、峰宽、组
  const specs: { group: 0 | 1 | 2; edgeTop: number; midTop: number; foot: number; width: number; mistH: number; kind: 0 | 1 | 2; trees: number; sides?: boolean }[] = [
    { group: 0, edgeTop: 0.09, midTop: 0.16, foot: 0.34, width: 0.3, mistH: 0.12, kind: 1, trees: 0 },
    { group: 0, edgeTop: 0.1, midTop: 0.23, foot: 0.44, width: 0.32, mistH: 0.13, kind: 0, trees: 0 },
    { group: 1, edgeTop: 0.08, midTop: 0.31, foot: 0.56, width: 0.36, mistH: 0.15, kind: 0, trees: 0.12 },
    // 谷底一层矮的圆山（带一排远树），地图缩小时露出来的地方不再是一片空白雾
    { group: 1, edgeTop: 0.46, midTop: 0.54, foot: 0.92, width: 0.24, mistH: 0.17, kind: 1, trees: 0.5 },
    { group: 1, edgeTop: 0.05, midTop: 0.5, foot: 0.86, width: 0.4, mistH: 0.2, kind: 1, trees: 0.2, sides: true },
    { group: 2, edgeTop: 0.62, midTop: 0.7, foot: 1.1, width: 0.5, mistH: 0.06, kind: 2, trees: 0.7 },
  ];
  const layers: LayerGeo[] = specs.map((s, idx) => {
    const peaks: Peak[] = [];
    let x = -margin * 0.6 - R() * s.width * w * 0.5;
    while (x < W - margin * 0.4) {
      const u = Math.max(0, Math.min(1, (x - margin) / w)); // 0..1 横跨屏幕
      const edge = Math.pow(Math.abs(u - 0.5) * 2, 1.6); // 屏幕两侧 = 1，中间 = 0
      const keep = !s.sides || u < 0.3 || u > 0.7;
      const top = (s.midTop + (s.edgeTop - s.midTop) * edge) * h + (R() - 0.5) * h * 0.05;
      const wl = w * s.width * (0.5 + R() * 0.45), wr = w * s.width * (0.5 + R() * 0.45);
      const foot = s.foot * h;
      if (keep && top < foot - h * 0.04) peaks.push(makePeak(R, x, top, foot, wl, wr, s.kind, s.trees));
      else { R(); R(); } // 不画的位置也照样消耗随机数（让各层几何稳定）
      x += w * s.width * (0.5 + R() * 0.45);
    }
    // 先画矮的、后画高的不对：山水是“后高前低”，同层里先画远（高）的、再画近（矮）的
    peaks.sort((a, b) => a.apex.y - b.apex.y);
    return { idx, group: s.group, peaks, foot: s.foot * h, mistH: s.mistH * h };
  });
  const clouds: Geo["clouds"] = [];
  for (let k = 0; k < 9; k++) {
    const group: 0 | 1 = k < 5 ? 0 : 1;
    clouds.push({ x: R() * W, y: h * (group === 0 ? 0.18 + R() * 0.2 : 0.38 + R() * 0.25), rx: w * (0.18 + R() * 0.25), ry: h * (0.012 + R() * 0.018), group });
  }
  // 瀑布：中景（第 3 层）里挑一座够高、在屏幕侧边的峰，从分界线三分之一处挂下来
  let fall: Geo["fall"] = null;
  const cand = layers[2]!.peaks.filter((p) => p.foot - p.apex.y > h * 0.25 && (p.apex.x - margin < w * 0.32 || p.apex.x - margin > w * 0.68));
  if (cand.length) {
    const p = cand[Math.floor(R() * cand.length)]!;
    const s = at(p.spine, 0.3);
    fall = { x0: s.x + 2, y0: s.y, y1: p.foot - (p.foot - p.apex.y) * 0.08, width: Math.max(2, w * 0.007) };
  }
  const birds: Pt[] = [];
  const bx = margin + w * (0.15 + R() * 0.2), by = h * (0.08 + R() * 0.05);
  for (let k = 0; k < 4; k++) birds.push({ x: bx + k * w * 0.025 + R() * 6, y: by + (R() - 0.5) * 10 });
  const moon = { x: margin + w * (0.74 + R() * 0.1), y: h * (0.09 + R() * 0.04) };
  const stars: Pt[] = [];
  for (let k = 0; k < 40; k++) stars.push({ x: R() * W, y: R() * h * 0.3 });
  return { w, h, margin, layers, clouds, fall, birds, moon, stars };
}

// ------------------------------------------------------------------ 颜色

interface LayerColor { top: string; mid: string; foot: string; shade: string; ink: number }
interface Pal {
  sky: [string, string];
  layers: LayerColor[];
  mist: string; // "r,g,b"
  inkRgb: string;
  tree: string;
  water: string;
  night: boolean;
}

/** 古旧绢本：远山灰青 → 中山石青石绿 → 近山墨绿，比旧版整体压暗一档 */
const AGED_DAY: Pal = {
  sky: ["#c8b88f", "#e0d4b2"],
  layers: [
    { top: "#7e8f8e", mid: "#8d9a8f", foot: "#b9b296", shade: "#5c6c72", ink: 0.16 },
    { top: "#62797a", mid: "#6f8573", foot: "#a7a17f", shade: "#47585f", ink: 0.24 },
    { top: "#4b6669", mid: "#557055", foot: "#857559", shade: "#33454c", ink: 0.36 },
    { top: "#4a6560", mid: "#4b654b", foot: "#736a50", shade: "#2f413f", ink: 0.42 },
    { top: "#3a5654", mid: "#425d40", foot: "#5f5641", shade: "#263639", ink: 0.48 },
    { top: "#2c4233", mid: "#2a3d2c", foot: "#2a3426", shade: "#1a2620", ink: 0.55 },
  ],
  mist: "228,219,192",
  inkRgb: "42,29,19",
  tree: "#22352a",
  water: "#eef0e4",
  night: false,
};
const AGED_NIGHT: Pal = {
  sky: ["#0d0f17", "#1d2232"],
  layers: [
    { top: "#2e3650", mid: "#2f384f", foot: "#363d55", shade: "#232a40", ink: 0.14 },
    { top: "#283149", mid: "#29334a", foot: "#2f364d", shade: "#1d2336", ink: 0.2 },
    { top: "#212b40", mid: "#212c3c", foot: "#262b3c", shade: "#171d2c", ink: 0.28 },
    { top: "#1d2738", mid: "#1d2734", foot: "#222633", shade: "#141a27", ink: 0.31 },
    { top: "#1a2333", mid: "#19222f", foot: "#1d212d", shade: "#111622", ink: 0.34 },
    { top: "#131a26", mid: "#111822", foot: "#10141c", shade: "#0b0f17", ink: 0.4 },
  ],
  mist: "44,52,76",
  inkRgb: "8,8,12",
  tree: "#0d131c",
  water: "#9fb0cf",
  night: true,
};
const QINGLV_DAY: Pal = {
  ...AGED_DAY,
  sky: ["#b7c8cc", "#dde5dc"],
  layers: [
    { top: "#7f9fae", mid: "#8faea6", foot: "#c1cfc4", shade: "#5f7f92", ink: 0.16 },
    { top: "#5f8ea0", mid: "#6c9a86", foot: "#b0c2ae", shade: "#466f84", ink: 0.24 },
    { top: "#447f95", mid: "#4f8a62", foot: "#9a8a62", shade: "#2f5d70", ink: 0.36 },
    { top: "#3c7286", mid: "#467f56", foot: "#7e7150", shade: "#2a5566", ink: 0.42 },
    { top: "#33677a", mid: "#3d7048", foot: "#6a5d40", shade: "#22495a", ink: 0.48 },
    { top: "#244a3a", mid: "#24432f", foot: "#26382a", shade: "#163024", ink: 0.55 },
  ],
  mist: "232,236,228",
};
const QINGLV_NIGHT: Pal = { ...AGED_NIGHT, sky: ["#0a1024", "#18223f"] };

const PALS: Record<ThemeId, { day: Pal; night: Pal }> = { aged: { day: AGED_DAY, night: AGED_NIGHT }, qinglv: { day: QINGLV_DAY, night: QINGLV_NIGHT } };

// ------------------------------------------------------------------ 绘制

function path(ctx: Ctx, pts: Pt[]): void {
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k]!.x, pts[k]!.y);
}

function drawPine(ctx: Ctx, p: Pt, s: number, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.6, s * 0.12);
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + s * 0.05, p.y - s); ctx.stroke();
  // 三层压扁的松针团，一层比一层小
  for (let k = 0; k < 3; k++) {
    const y = p.y - s * (0.35 + k * 0.25), r = s * (0.42 - k * 0.1);
    ctx.beginPath(); ctx.ellipse(p.x + s * 0.04 * k, y, r, r * 0.32, -0.12, 0, Math.PI * 2); ctx.fill();
  }
}

function drawPeak(ctx: Ctx, pk: Peak, col: LayerColor, pal: Pal, li: number, scaleW: number): void {
  const H = pk.foot - pk.apex.y;
  // 山体：左坡 + 右坡围成，竖向渐变（峰顶石青 → 山腰石绿 → 山脚赭石入雾）
  ctx.beginPath();
  path(ctx, pk.left);
  for (let k = 1; k < pk.right.length; k++) ctx.lineTo(pk.right[k]!.x, pk.right[k]!.y);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, pk.apex.y, 0, pk.foot);
  g.addColorStop(0, col.top); g.addColorStop(0.45, col.mid); g.addColorStop(1, col.foot);
  ctx.fillStyle = g;
  ctx.fill();
  // 背光面：分界线 → 右坡，越往上越深
  ctx.beginPath();
  path(ctx, pk.spine);
  for (let k = pk.right.length - 1; k >= 0; k--) ctx.lineTo(pk.right[k]!.x, pk.right[k]!.y);
  ctx.closePath();
  const sg = ctx.createLinearGradient(pk.apex.x, pk.apex.y, pk.apex.x, pk.foot);
  sg.addColorStop(0, col.shade); sg.addColorStop(1, col.foot);
  ctx.globalAlpha = 0.78;
  ctx.fillStyle = sg;
  ctx.fill();
  ctx.globalAlpha = 1;
  // 受光面：沿左坡一道亮边（左上来光）
  if (!pal.night) {
    ctx.save();
    ctx.beginPath(); path(ctx, pk.left); ctx.lineTo(pk.spine[Math.floor(pk.spine.length * 0.6)]!.x, pk.spine[Math.floor(pk.spine.length * 0.6)]!.y); ctx.closePath(); ctx.clip();
    // 受光面整片提亮一点（左上来光），往山脚淡出
    const lg = ctx.createLinearGradient(pk.apex.x - H * 0.3, pk.apex.y, pk.apex.x, pk.foot);
    lg.addColorStop(0, "rgba(246,238,214,0.22)"); lg.addColorStop(1, "rgba(246,238,214,0)");
    ctx.fillStyle = lg; ctx.fillRect(pk.apex.x - H * 2, pk.apex.y, H * 4, H);
    ctx.restore();
  }
  const ink = `rgba(${pal.inkRgb},`;
  // 皴笔
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(0.6, 0.5 + li * 0.25) * scaleW;
  ctx.strokeStyle = `${ink}${col.ink * 0.75})`;
  for (const [a, c, b] of pk.strokes) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke(); }
  // 阴阳分界上半截一道淡墨（山的“骨”）
  ctx.strokeStyle = `${ink}${col.ink * 0.55})`;
  ctx.lineWidth = Math.max(0.7, 0.6 + li * 0.3) * scaleW;
  ctx.beginPath(); path(ctx, pk.spine.slice(0, Math.ceil(pk.spine.length * 0.55))); ctx.stroke();
  // 山脊墨线：粗细起伏（书法笔意）
  ctx.strokeStyle = `${ink}${col.ink})`;
  const ridge = [...pk.left, ...pk.right.slice(1)];
  for (let k = 0; k < ridge.length - 1; k++) {
    const t = k / (ridge.length - 1);
    const lift = 1 - Math.abs(ridge[k]!.y - pk.apex.y) / Math.max(1, H); // 越近峰顶越粗
    ctx.lineWidth = (0.5 + li * 0.35 + lift * (0.8 + li * 0.3)) * scaleW * (0.8 + 0.4 * Math.sin(t * 17 + li));
    ctx.beginPath(); ctx.moveTo(ridge[k]!.x, ridge[k]!.y); ctx.lineTo(ridge[k + 1]!.x, ridge[k + 1]!.y); ctx.stroke();
  }
  // 点苔（远山不点）
  if (li >= 1) {
    ctx.fillStyle = `${ink}${Math.min(0.75, col.ink * 1.3)})`;
    for (const m of pk.moss) { ctx.beginPath(); ctx.ellipse(m.x, m.y, (0.7 + li * 0.35) * scaleW, (0.5 + li * 0.25) * scaleW, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  // 山头松
  if (pk.trees.length) {
    const s = (li >= 5 ? 13 : li === 4 ? 8 : li === 3 ? 5.5 : 5) * scaleW;
    for (const t of pk.trees) drawPine(ctx, t, s * (0.8 + ((t.x * 7.3) % 1) * 0.4), pal.tree);
  }
}

function drawMist(ctx: Ctx, y0: number, y1: number, x0: number, x1: number, mist: string, a: number): void {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, `rgba(${mist},0)`);
  g.addColorStop(0.55, `rgba(${mist},${a * 0.7})`);
  g.addColorStop(0.85, `rgba(${mist},${a})`);
  g.addColorStop(1, `rgba(${mist},1)`); // 山脚完全没入雾里，下面接云海不留缝
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

function drawCloud(ctx: Ctx, c: Geo["clouds"][0], mist: string, a: number): void {
  // 横向拉长的几团软云（径向渐变 + 压扁）
  for (let k = 0; k < 3; k++) {
    const cx = c.x + (k - 1) * c.rx * 0.55, cy = c.y + (k === 1 ? -c.ry * 0.4 : 0), rx = c.rx * (k === 1 ? 0.7 : 0.5);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, c.ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(${mist},${a})`);
    g.addColorStop(1, `rgba(${mist},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function paintGroup(ctx: Ctx, geo: Geo, pal: Pal, group: 0 | 1 | 2): void {
  const { w, h, margin } = geo;
  const W = w + margin * 2;
  const scaleW = Math.max(0.8, Math.min(1.6, w / 390));
  if (group === 0) {
    // 天：上深下浅（绢色 / 夜空）
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.6);
    g.addColorStop(0, pal.sky[0]); g.addColorStop(1, pal.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, -h, W, h * 3); // 上下都铺满（画布比屏幕高）
    if (pal.night) {
      ctx.fillStyle = "rgba(230,226,205,0.55)";
      for (const s of geo.stars) { ctx.beginPath(); ctx.arc(s.x, s.y, 0.6 + ((s.x * 13) % 1) * 0.6, 0, Math.PI * 2); ctx.fill(); }
      const m = geo.moon, r = w * 0.045;
      const halo = ctx.createRadialGradient(m.x, m.y, r * 0.8, m.x, m.y, r * 5);
      halo.addColorStop(0, "rgba(232,226,200,0.35)"); halo.addColorStop(1, "rgba(232,226,200,0)");
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(m.x, m.y, r * 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e9e3c6"; ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = `rgba(${pal.inkRgb},0.55)`; ctx.lineWidth = 1.1 * scaleW; ctx.lineCap = "round";
      for (const b of geo.birds) {
        const s = 4 * scaleW;
        ctx.beginPath(); ctx.moveTo(b.x - s, b.y - s * 0.3); ctx.quadraticCurveTo(b.x - s * 0.4, b.y - s * 0.6, b.x, b.y); ctx.quadraticCurveTo(b.x + s * 0.4, b.y - s * 0.6, b.x + s, b.y - s * 0.3); ctx.stroke();
      }
    }
  }
  for (const L of geo.layers) {
    if (L.group !== group) continue;
    const col = pal.layers[L.idx]!;
    for (const pk of L.peaks) drawPeak(ctx, pk, col, pal, L.idx, scaleW);
    // 山脚入雾（最近一层压在画面底下，不加雾，免得把底部洗白）
    if (L.idx < 5) drawMist(ctx, L.foot - L.mistH, L.foot + h * 0.02, 0, W, pal.mist, pal.night ? 0.75 : 0.88);
    // 山脚以下到下一层之间：同色雾一直铺下去（云海），不留硬边
    if (L.idx === 2) { ctx.fillStyle = `rgb(${pal.mist})`; ctx.fillRect(0, L.foot + h * 0.02 - 1, W, h * 0.3); }
    if (L.idx === 2 && geo.fall) {
      // 一线瀑布 + 潭口水雾
      const f = geo.fall;
      const g = ctx.createLinearGradient(0, f.y0, 0, f.y1);
      g.addColorStop(0, `rgba(${pal.night ? "160,176,207" : "238,240,228"},0)`);
      g.addColorStop(0.15, pal.water);
      g.addColorStop(1, pal.water);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(f.x0 - f.width * 0.3, f.y0); ctx.lineTo(f.x0 + f.width * 0.3, f.y0);
      ctx.quadraticCurveTo(f.x0 + f.width * 0.9, (f.y0 + f.y1) / 2, f.x0 + f.width * 0.8, f.y1);
      ctx.lineTo(f.x0 - f.width * 0.6, f.y1);
      ctx.quadraticCurveTo(f.x0 - f.width * 0.5, (f.y0 + f.y1) / 2, f.x0 - f.width * 0.3, f.y0);
      ctx.fill();
      ctx.strokeStyle = `rgba(${pal.inkRgb},0.18)`; ctx.lineWidth = 0.6;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(f.x0 + (k - 1) * f.width * 0.25, f.y0 + 6); ctx.lineTo(f.x0 + (k - 1) * f.width * 0.3, f.y1); ctx.stroke(); }
      drawCloud(ctx, { x: f.x0, y: f.y1, rx: w * 0.06, ry: h * 0.012, group: 1 }, pal.mist, 0.9);
    }
    if (L.idx === 1 || L.idx === 3) for (const c of geo.clouds) if (c.group === (L.idx === 1 ? 0 : 1)) drawCloud(ctx, c, pal.mist, pal.night ? 0.5 : 0.7);
  }
}

/** 画三张视差层（远 / 中 / 近）。远层不透明（含天空），中、近层透明 */
export function paintBackdropLayers(createCanvas: (w: number, h: number) => HTMLCanvasElement, w: number, h: number, night: boolean, seed = 5,
  theme: ThemeId = "aged", dpr = 1): BackdropLayer[] {
  const margin = Math.round(w * 0.22);
  const geo = makeGeo(w, h, margin, seed);
  const pal = night ? PALS[theme].night : PALS[theme].day;
  // 远层糊一点不要紧（本来就隔着雾），省显存；中、近层按屏幕像素画
  const plan: { group: 0 | 1 | 2; depth: number; scale: number }[] = [
    { group: 0, depth: 0.05, scale: Math.min(dpr, 1.25) },
    { group: 1, depth: 0.14, scale: Math.min(dpr, 1.75) },
    { group: 2, depth: 0.3, scale: Math.min(dpr, 1.75) },
  ];
  return plan.map(({ group, depth, scale }) => {
    const vpad = Math.round(h * 0.1);
    const c = createCanvas(Math.round((w + margin * 2) * scale), Math.round((h + vpad * 2) * scale));
    const ctx = c.getContext("2d")!;
    ctx.setTransform(scale, 0, 0, scale, 0, vpad * scale);
    ctx.clearRect(0, -vpad, w + margin * 2, h + vpad * 2);
    paintGroup(ctx, geo, pal, group);
    return { canvas: c, depth, margin, scale, vpad };
  });
}

/** 把三张视差层画到屏幕上：dx / dy = 相机相对“刚框好地图时”的平移量 */
export function drawBackdropLayers(ctx: Ctx, layers: BackdropLayer[], w: number, h: number, dx: number, dy: number, alpha: number): void {
  if (alpha <= 0.002) return;
  for (const L of layers) {
    const ox = Math.max(-L.margin, Math.min(L.margin, dx * L.depth));
    const oy = Math.max(-L.vpad * 0.9, Math.min(L.vpad * 0.9, dy * L.depth * 0.6));
    ctx.globalAlpha = alpha;
    ctx.drawImage(L.canvas, -L.margin + ox, -L.vpad + oy, w + L.margin * 2, h + L.vpad * 2);
  }
  ctx.globalAlpha = 1;
}
