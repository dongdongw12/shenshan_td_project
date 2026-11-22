/**
 * 开发台用的程序化村民（墨线 + 矿物色，斗笠赭衣），用来检验移动单位与多格建筑的遮挡排序。
 * 正式角色会是烘培/手绘序列帧，这里只是占位。
 */
import { hexToRgb, mixRgb } from "../render/dayNight";
import type { Vec2 } from "../render/iso";

const INK = "#1c1510";
const HAT = hexToRgb("#d9a838");
const COAT = hexToRgb("#9a5a35");
const PANTS = hexToRgb("#2e5f8f");
const SKIN = hexToRgb("#e8c9a0");
const NIGHT = hexToRgb("#2c3a6e");

/** 夜里颜色往夜靛压暗（与精灵的夜晚风格接近） */
function shade(c: [number, number, number], a: number): string {
  const dim: [number, number, number] = [c[0] * 0.35, c[1] * 0.38, c[2] * 0.5];
  return mixRgb(c, [Math.min(255, (dim[0] + NIGHT[0]) / 1.4), Math.min(255, (dim[1] + NIGHT[1]) / 1.4), Math.min(255, (dim[2] + NIGHT[2]) / 1.4)], a);
}

export function drawVillager(ctx: CanvasRenderingContext2D, p: Vec2, ppm: number, nightAlpha: number, step: number): void {
  const u = ppm * 0.1; // 0.1 米对应的像素
  const lw = Math.max(1, u * 0.28);
  const bob = Math.sin(step * Math.PI * 2) * u * 0.25;
  ctx.save();
  ctx.translate(p.x, p.y);
  // 脚下墨色小地影
  ctx.globalAlpha = 0.35 * (1 - 0.4 * nightAlpha);
  ctx.fillStyle = "#1f2740";
  ctx.beginPath();
  ctx.ellipse(0, 0, u * 3.2, u * 1.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  const legSwing = Math.sin(step * Math.PI * 2) * u * 1.2;
  // 腿
  ctx.fillStyle = shade(PANTS, nightAlpha);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.roundRect(s * u * 1.1 - u * 0.75 + (s > 0 ? legSwing : -legSwing) * 0.3, -u * 5.5, u * 1.5, u * 5.5, u * 0.5);
    ctx.fill(); ctx.stroke();
  }
  // 身体（短褐）
  ctx.fillStyle = shade(COAT, nightAlpha);
  ctx.beginPath();
  ctx.moveTo(-u * 2.6, -u * 5 + bob);
  ctx.lineTo(u * 2.6, -u * 5 + bob);
  ctx.lineTo(u * 2.1, -u * 11 + bob);
  ctx.lineTo(-u * 2.1, -u * 11 + bob);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // 头
  ctx.fillStyle = shade(SKIN, nightAlpha);
  ctx.beginPath();
  ctx.arc(0, -u * 12.6 + bob, u * 1.7, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // 斗笠
  ctx.fillStyle = shade(HAT, nightAlpha);
  ctx.beginPath();
  ctx.moveTo(-u * 3.6, -u * 13 + bob);
  ctx.quadraticCurveTo(0, -u * 17.5 + bob, u * 3.6, -u * 13 + bob);
  ctx.quadraticCurveTo(0, -u * 12.2 + bob, -u * 3.6, -u * 13 + bob);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

/** 沿闭合折线匀速走，返回位置与朝向无关的步态相位 */
export function walkLoop(path: Vec2[], dist: number): Vec2 {
  const segs = path.map((a, k) => {
    const b = path[(k + 1) % path.length]!;
    return { a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
  });
  const total = segs.reduce((s, g) => s + g.len, 0);
  let d = ((dist % total) + total) % total;
  for (const g of segs) {
    if (d <= g.len) {
      const t = d / g.len;
      return { x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t };
    }
    d -= g.len;
  }
  return path[0]!;
}
