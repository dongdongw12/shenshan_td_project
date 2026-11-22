/**
 * 演示用的程序化墨线画（还没有烘培精灵的建筑、所有敌人、弹道、特效）。
 * 色板与墨色取自 docs/art/ART_BIBLE.md，夜里统一往夜靛压暗，和烘培精灵的夜晚风格接近。
 * 正式资产到位后，这里的建筑占位会被烘培精灵替换；敌人会换成序列帧。
 */
import type { Vec2 } from "../render/iso";

export type ToScreen = (x: number, y: number, z?: number) => Vec2;
type RGB = [number, number, number];

export const INK = "#1c1510";
const NIGHT: RGB = [38, 48, 88];

function hex(h: string): RGB {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
}

/** 夜色：压暗并偏夜靛 */
export function tone(color: string, night: number, lift = 0): string {
  const c = hex(color);
  // 与烘培精灵的夜晚版亮度对齐（浅色墙面夜里约是灰蓝 70~110）
  const dark: RGB = [c[0] * 0.2 + NIGHT[0] * 0.6, c[1] * 0.22 + NIGHT[1] * 0.6, c[2] * 0.26 + NIGHT[2] * 0.65];
  const m = c.map((v, k) => Math.round(Math.min(255, (v + (dark[k]! - v) * night) * (1 + lift)))) as RGB;
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}

function poly(ctx: CanvasRenderingContext2D, pts: Vec2[]): void {
  ctx.beginPath();
  pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function inkFill(ctx: CanvasRenderingContext2D, pts: Vec2[], fill: string, lw: number): void {
  poly(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/** 等距方盒：可见面是顶面、−Y（左下）面、+X（右下）面 */
export function isoBox(ctx: CanvasRenderingContext2D, S: ToScreen, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number,
  colors: { top: string; left: string; right: string }, lw: number): void {
  inkFill(ctx, [S(x0, y0, z0), S(x1, y0, z0), S(x1, y0, z1), S(x0, y0, z1)], colors.left, lw);
  inkFill(ctx, [S(x1, y0, z0), S(x1, y1, z0), S(x1, y1, z1), S(x1, y0, z1)], colors.right, lw);
  inkFill(ctx, [S(x0, y0, z1), S(x1, y0, z1), S(x1, y1, z1), S(x0, y1, z1)], colors.top, lw);
}

/** 四坡顶（攒尖/庑殿简化）：从 rect 外扩 eave 出檐，到 ridgeZ 收成一条沿 X 的脊 */
export function hipRoof(ctx: CanvasRenderingContext2D, S: ToScreen, x0: number, y0: number, x1: number, y1: number, baseZ: number, ridgeZ: number,
  eave: number, color: string, shade: string, lw: number): void {
  const ex0 = x0 - eave, ex1 = x1 + eave, ey0 = y0 - eave, ey1 = y1 + eave;
  const midY = (ey0 + ey1) / 2;
  const inset = Math.min((ex1 - ex0) * 0.3, (ey1 - ey0) / 2);
  const r0 = S(ex0 + inset, midY, ridgeZ), r1 = S(ex1 - inset, midY, ridgeZ);
  // 后坡与左坡大多被挡住，只画能看到的前坡（−Y）和右坡（+X）
  inkFill(ctx, [S(ex0, ey0, baseZ), S(ex1, ey0, baseZ), r1, r0], color, lw);
  inkFill(ctx, [S(ex1, ey0, baseZ), S(ex1, ey1, baseZ), r1], shade, lw);
}

export interface Palette { wall: string; wallShade: string; roof: string; roofShade: string; top?: string }

export const PAL = {
  lime: "#ede3cc", limeShade: "#c9bfa6", tile: "#3e4552", tileShade: "#2e3440", wood: "#9a5a35", woodShade: "#74431f",
  thatch: "#d9a838", thatchShade: "#a87f22", stone: "#7d8a8c", stoneShade: "#5f6b6a", cinnabar: "#b8352a",
  green: "#8fb062", greenDark: "#5f7f3c", ridge: "#b08a5a", water: "#5d8fb6", bamboo: "#6f9a52",
};

/** 民居类占位：墙身 + 四坡顶 */
export function drawHouseLike(ctx: CanvasRenderingContext2D, S: ToScreen, x0: number, y0: number, x1: number, y1: number,
  wallH: number, roofH: number, p: Palette, night: number, lw: number, extra?: (z: number) => void): void {
  isoBox(ctx, S, x0 + 0.15, y0 + 0.15, x1 - 0.15, y1 - 0.15, 0, wallH,
    { top: tone(p.wall, night), left: tone(p.wall, night), right: tone(p.wallShade, night) }, lw);
  extra?.(wallH);
  hipRoof(ctx, S, x0 + 0.15, y0 + 0.15, x1 - 0.15, y1 - 0.15, wallH, wallH + roofH, 0.35, tone(p.roof, night), tone(p.roofShade, night), lw);
}

/** 尖木篱笆：一排削尖的木桩 */
export function drawFence(ctx: CanvasRenderingContext2D, S: ToScreen, i: number, j: number, T: number, night: number, lw: number, brick: boolean): void {
  const x0 = i * T, y0 = j * T, x1 = x0 + T, y1 = y0 + T;
  if (brick) {
    isoBox(ctx, S, x0 + 0.2, y0 + 0.2, x1 - 0.2, y1 - 0.2, 0, 2.2,
      { top: tone("#8b9592", night), left: tone(PAL.stone, night), right: tone(PAL.stoneShade, night) }, lw);
    isoBox(ctx, S, x0 + 0.05, y0 + 0.05, x1 - 0.05, y1 - 0.05, 2.2, 2.5,
      { top: tone(PAL.tile, night), left: tone(PAL.tileShade, night), right: tone(PAL.tileShade, night) }, lw);
    return;
  }
  for (let k = 0; k < 4; k++) {
    const cx = x0 + 0.3 + k * 0.47, cy = y0 + 0.3 + k * 0.47;
    const h = 1.5 + ((k * 37) % 5) * 0.06;
    const r = 0.16;
    isoBox(ctx, S, cx - r, cy - r, cx + r, cy + r, 0, h, { top: tone(PAL.wood, night), left: tone(PAL.wood, night), right: tone(PAL.woodShade, night) }, lw * 0.8);
    inkFill(ctx, [S(cx - r, cy - r, h), S(cx + r, cy - r, h), S(cx + r, cy + r, h), S(cx, cy, h + 0.45)], tone("#c88f5f", night), lw * 0.7);
  }
}

/** 稻田（贴地）：青苗绿 + 秧行 + 田埂 */
export function drawFarmDecal(ctx: CanvasRenderingContext2D, S: ToScreen, i: number, j: number, w: number, d: number, T: number, night: number, lw: number, grown: number): void {
  const x0 = i * T + 0.1, y0 = j * T + 0.1, x1 = (i + w) * T - 0.1, y1 = (j + d) * T - 0.1;
  poly(ctx, [S(x0, y0), S(x1, y0), S(x1, y1), S(x0, y1)]);
  ctx.fillStyle = tone(grown > 0.85 ? "#c9b05a" : PAL.green, night);
  ctx.fill();
  ctx.strokeStyle = tone(PAL.ridge, night);
  ctx.lineWidth = lw * 2.2;
  ctx.stroke();
  ctx.strokeStyle = tone(PAL.greenDark, night);
  ctx.lineWidth = lw * 0.8;
  ctx.beginPath();
  for (let r = 1; r < 6; r++) {
    const y = y0 + ((y1 - y0) * r) / 6;
    const a = S(x0 + 0.2, y), b = S(x1 - 0.2, y);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

/** 鱼梁（贴水）：木桩栅 + 小水车 */
export function drawWeirDecal(ctx: CanvasRenderingContext2D, S: ToScreen, i: number, j: number, w: number, d: number, T: number, night: number, lw: number, t: number): void {
  const x0 = i * T, y0 = j * T, x1 = (i + w) * T, y1 = (j + d) * T;
  ctx.strokeStyle = tone(PAL.wood, night);
  ctx.lineWidth = lw * 1.6;
  ctx.beginPath();
  for (let k = 0; k <= 6; k++) {
    const x = x0 + ((x1 - x0) * k) / 6;
    const a = S(x, (y0 + y1) / 2 - 0.4, 0), b = S(x, (y0 + y1) / 2 - 0.4, 0.6);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  const a = S(x0, (y0 + y1) / 2 - 0.4, 0.45), b = S(x1, (y0 + y1) / 2 - 0.4, 0.45);
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.stroke();
  const c = S(x1 - 0.6, (y0 + y1) / 2 + 0.3, 0.9);
  const r = Math.abs(S(0, 0, 0.8).y - S(0, 0, 0).y);
  ctx.strokeStyle = INK; ctx.lineWidth = lw;
  ctx.fillStyle = tone(PAL.wood, night);
  ctx.beginPath(); ctx.ellipse(c.x, c.y, r * 0.55, r, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const ang = t * 1.5 + (k * Math.PI) / 3;
    ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.cos(ang) * r * 0.55, c.y + Math.sin(ang) * r);
  }
  ctx.stroke();
}

/** 捕兽夹（贴地） */
export function drawTrapDecal(ctx: CanvasRenderingContext2D, S: ToScreen, i: number, j: number, T: number, night: number, lw: number, charges: number): void {
  const c = S((i + 0.5) * T, (j + 0.5) * T);
  const rx = Math.abs(S(0.45, -0.45).x - S(0, 0).x), ry = rx / 2;
  ctx.strokeStyle = INK; ctx.lineWidth = lw;
  ctx.fillStyle = tone("#6b7482", night);
  ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2;
    ctx.moveTo(c.x + Math.cos(ang) * rx * 0.55, c.y + Math.sin(ang) * ry * 0.55);
    ctx.lineTo(c.x + Math.cos(ang) * rx * 0.95, c.y + Math.sin(ang) * ry * 0.95 - ry * 0.25);
  }
  ctx.stroke();
  ctx.fillStyle = INK;
  for (let k = 0; k < charges; k++) ctx.fillRect(c.x - rx * 0.3 + k * rx * 0.3, c.y + ry * 1.2, rx * 0.18, ry * 0.3);
}

// ============================================================================ 敌人

export interface EnemyLook { body: string; trim: string; kind: "wolf" | "boar" | "bear" | "human"; scale: number; prop?: "shield" | "torch" | "banner" | "saber" }

export const ENEMY_LOOK: Record<string, EnemyLook> = {
  wolf: { body: "#7d8288", trim: "#4c5056", kind: "wolf", scale: 1 },
  boar: { body: "#6b4735", trim: "#3f2a20", kind: "boar", scale: 1.1 },
  bear_king: { body: "#2b2421", trim: "#b8352a", kind: "bear", scale: 1.9 },
  scout: { body: "#5c6b4a", trim: "#b8352a", kind: "human", scale: 0.95 },
  swordsman: { body: "#3e4552", trim: "#b8352a", kind: "human", scale: 1, prop: "saber" },
  shield: { body: "#4a3f35", trim: "#b8352a", kind: "human", scale: 1.05, prop: "shield" },
  arsonist: { body: "#5c3a26", trim: "#d9a838", kind: "human", scale: 1, prop: "torch" },
  second_chief: { body: "#232a40", trim: "#b8352a", kind: "human", scale: 1.5, prop: "banner" },
  chief: { body: "#1c1510", trim: "#d9a838", kind: "human", scale: 1.8, prop: "banner" },
};

/** 在脚底屏幕坐标 p 处画敌人；u = 0.1 米对应的像素；face = ±1（朝向）；step 步态相位 */
export function drawEnemy(ctx: CanvasRenderingContext2D, type: string, p: Vec2, u: number, night: number, face: number, step: number, hpFrac: number, t: number): void {
  const look = ENEMY_LOOK[type] ?? ENEMY_LOOK.swordsman!;
  const s = look.scale;
  const lw = Math.max(0.8, u * 0.35);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalAlpha = 0.3 * (1 - 0.4 * night);
  ctx.fillStyle = "#1f2740";
  ctx.beginPath(); ctx.ellipse(0, 0, u * 4 * s, u * 1.6 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.scale(face, 1);
  ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.lineJoin = "round"; ctx.lineCap = "round";
  const body = tone(look.body, night, 0.05), trim = tone(look.trim, night * 0.6);
  const bob = Math.sin(step * Math.PI * 2) * u * 0.4;
  if (look.kind !== "human") {
    const L = (look.kind === "wolf" ? 6 : look.kind === "boar" ? 5.5 : 7.5) * u * s;
    const H = (look.kind === "wolf" ? 3.2 : look.kind === "boar" ? 3.6 : 5.2) * u * s;
    // 腿
    ctx.strokeStyle = INK;
    ctx.beginPath();
    for (const [lx, ph] of [[-0.55, 0], [0.45, 0.5]] as const) {
      const sw = Math.sin((step + ph) * Math.PI * 2) * u * 1.2 * s;
      ctx.moveTo(lx * L + sw * 0.4, -H * 0.55); ctx.lineTo(lx * L + sw, 0);
      ctx.moveTo(lx * L - sw * 0.4 + u, -H * 0.55); ctx.lineTo(lx * L - sw + u, 0);
    }
    ctx.lineWidth = lw * 1.8; ctx.stroke(); ctx.lineWidth = lw;
    // 身体
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, -H * 0.75 + bob, L * 0.62, H * 0.42, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // 头
    ctx.beginPath();
    if (look.kind === "wolf") {
      ctx.moveTo(L * 0.45, -H * 0.95 + bob); ctx.lineTo(L * 0.95, -H * 0.85 + bob); ctx.lineTo(L * 0.5, -H * 0.55 + bob);
      ctx.moveTo(L * 0.5, -H * 1.0 + bob); ctx.lineTo(L * 0.58, -H * 1.35 + bob); ctx.lineTo(L * 0.66, -H * 0.98 + bob);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-L * 0.6, -H * 0.85 + bob); ctx.quadraticCurveTo(-L * 0.95, -H * 1.1 + bob, -L * 0.9, -H * 0.5 + bob); ctx.stroke();
    } else {
      ctx.ellipse(L * 0.62, -H * 0.72 + bob, L * 0.22, H * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ede3cc";
      ctx.beginPath(); ctx.moveTo(L * 0.78, -H * 0.62 + bob); ctx.lineTo(L * 0.92, -H * 0.85 + bob); ctx.lineTo(L * 0.82, -H * 0.58 + bob); ctx.fill(); ctx.stroke();
      if (look.kind === "bear") { ctx.fillStyle = trim; ctx.fillRect(-L * 0.1, -H * 1.05 + bob, L * 0.12, H * 0.6); }
    }
  } else {
    const k = s * u;
    const sw = Math.sin(step * Math.PI * 2) * k * 1.3;
    ctx.fillStyle = tone("#2e2a2a", night);
    for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sgn * k * 0.9, -k * 5.5); ctx.lineTo(sgn * k * 0.9 + sgn * sw * 0.5, 0); ctx.lineWidth = lw * 2.2; ctx.stroke(); }
    ctx.lineWidth = lw;
    ctx.fillStyle = body;
    poly(ctx, [{ x: -k * 2.4, y: -k * 4.8 + bob }, { x: k * 2.4, y: -k * 4.8 + bob }, { x: k * 2, y: -k * 11 + bob }, { x: -k * 2, y: -k * 11 + bob }]);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = trim; ctx.fillRect(-k * 2.2, -k * 7.4 + bob, k * 4.4, k * 0.9);
    ctx.fillStyle = tone("#e2c19a", night);
    ctx.beginPath(); ctx.arc(0, -k * 12.6 + bob, k * 1.7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = trim; ctx.fillRect(-k * 1.8, -k * 13.8 + bob, k * 3.6, k * 0.8);
    if (look.prop === "shield") {
      ctx.fillStyle = tone("#7a5232", night);
      poly(ctx, [{ x: k * 1.6, y: -k * 10 + bob }, { x: k * 4.2, y: -k * 9.4 + bob }, { x: k * 4.2, y: -k * 3.6 + bob }, { x: k * 1.6, y: -k * 3.2 + bob }]);
      ctx.fill(); ctx.stroke();
    } else if (look.prop === "saber") {
      ctx.beginPath(); ctx.moveTo(k * 2.2, -k * 7 + bob); ctx.quadraticCurveTo(k * 5, -k * 10 + bob, k * 5.6, -k * 13 + bob); ctx.lineWidth = lw * 1.4; ctx.stroke(); ctx.lineWidth = lw;
    } else if (look.prop === "torch") {
      ctx.beginPath(); ctx.moveTo(k * 2.2, -k * 7 + bob); ctx.lineTo(k * 3.6, -k * 12 + bob); ctx.stroke();
      const fl = 1 + Math.sin(t * 18) * 0.15;
      ctx.fillStyle = night > 0.3 ? "#ffb347" : "#f08a2c";
      ctx.beginPath(); ctx.ellipse(k * 3.7, -k * 13.2 + bob, k * 0.9 * fl, k * 1.6 * fl, 0, 0, Math.PI * 2); ctx.fill();
    } else if (look.prop === "banner") {
      ctx.beginPath(); ctx.moveTo(-k * 2.4, -k * 6 + bob); ctx.lineTo(-k * 2.4, -k * 20 + bob); ctx.lineWidth = lw * 1.3; ctx.stroke(); ctx.lineWidth = lw;
      ctx.fillStyle = tone("#1c1510", night * 0.3);
      poly(ctx, [{ x: -k * 2.4, y: -k * 20 + bob }, { x: -k * 8, y: -k * 18.5 + bob }, { x: -k * 2.4, y: -k * 15.5 + bob }]);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = trim; ctx.font = `${Math.max(6, k * 2.2)}px serif`; ctx.fillText("黑", -k * 6.4, -k * 17.4 + bob);
    }
  }
  ctx.restore();
  if (hpFrac < 0.999) {
    const w = u * 6 * Math.max(1, look.scale * 0.8), h = Math.max(2, u * 0.8);
    const y = p.y - u * (look.kind === "human" ? 17 : 9) * look.scale;
    ctx.fillStyle = "rgba(28,21,16,0.75)"; ctx.fillRect(p.x - w / 2 - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = "#b8352a"; ctx.fillRect(p.x - w / 2, y, w * Math.max(0, hpFrac), h);
  }
}

/** 击退：冒烟逃跑（不做血腥） */
export function drawSmoke(ctx: CanvasRenderingContext2D, p: Vec2, u: number, age: number, life: number): void {
  const k = age / life;
  ctx.save();
  for (let n = 0; n < 4; n++) {
    const ang = n * 1.7;
    ctx.globalAlpha = 0.45 * (1 - k);
    ctx.fillStyle = n % 2 ? "#cfc8bb" : "#9a9286";
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(ang) * u * 5 * k, p.y - u * (4 + 10 * k) + Math.sin(ang) * u * 2, u * (1.6 + 3 * k), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawArrow(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, k: number, u: number, fire: boolean): void {
  const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * u * 12;
  const dx = b.x - a.x, dy = b.y - a.y + Math.cos(k * Math.PI) * u * 24;
  const len = Math.hypot(dx, dy) || 1;
  ctx.strokeStyle = fire ? "#f08a2c" : INK;
  ctx.lineWidth = Math.max(1, u * (fire ? 0.9 : 0.45));
  ctx.beginPath();
  ctx.moveTo(x - (dx / len) * u * 4, y - (dy / len) * u * 4);
  ctx.lineTo(x, y);
  ctx.stroke();
}

export function drawFloatText(ctx: CanvasRenderingContext2D, p: Vec2, text: string, color: string, age: number, life: number, size: number): void {
  ctx.save();
  ctx.globalAlpha = 1 - age / life;
  ctx.font = `bold ${size}px "PingFang SC", serif`;
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(28,21,16,0.8)";
  ctx.strokeText(text, p.x, p.y - age * 18);
  ctx.fillStyle = color;
  ctx.fillText(text, p.x, p.y - age * 18);
  ctx.restore();
}
