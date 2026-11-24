/**
 * 资源小图标（墨线 + 矿物色），用 Canvas2D 路径画（小游戏没有 DOM / SVG）。
 * 坐标按 16×16 的格子写，与原先网页版的内联 SVG 一一对应。
 */
const INK = "#1c1510";

type Ctx = CanvasRenderingContext2D;

function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function fillStroke(c: Ctx, fill: string | null, lw: number, stroke = INK): void {
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (lw > 0) { c.lineWidth = lw; c.strokeStyle = stroke; c.stroke(); }
}

const DRAW: Record<string, (c: Ctx) => void> = {
  coin: (c) => {
    c.beginPath(); c.arc(8, 8, 6.4, 0, Math.PI * 2); fillStroke(c, "#d9a838", 1.3);
    c.beginPath(); c.arc(8, 8, 4.6, 0, Math.PI * 2); fillStroke(c, null, 0.7, "#9a5a35");
    c.beginPath(); c.rect(6.1, 6.1, 3.8, 3.8); fillStroke(c, "#f1e8d4", 1);
  },
  wood: (c) => {
    rrect(c, 1.6, 8, 10.5, 4.6, 1); fillStroke(c, "#9a5a35", 1.1);
    c.beginPath(); c.ellipse(12.2, 10.3, 2.1, 2.3, 0, 0, Math.PI * 2); fillStroke(c, "#c88f5f", 1.1);
    rrect(c, 3.2, 3.4, 8.8, 4.4, 1); fillStroke(c, "#9a5a35", 1.1);
    c.beginPath(); c.ellipse(12, 5.6, 1.9, 2.2, 0, 0, Math.PI * 2); fillStroke(c, "#c88f5f", 1.1);
  },
  food: (c) => {
    c.beginPath(); c.moveTo(8, 15); c.lineTo(3, 4); c.quadraticCurveTo(4, 1.5, 6, 3); c.lineTo(8, 9); c.lineTo(10, 3);
    c.quadraticCurveTo(12, 1.5, 13, 4); c.closePath(); fillStroke(c, "#d9a838", 1.1);
    c.beginPath(); c.moveTo(8, 9); c.lineTo(8, 2.2); fillStroke(c, null, 1.1);
    c.beginPath(); c.arc(8, 2, 1.3, 0, Math.PI * 2); fillStroke(c, "#d9a838", 1);
    c.beginPath(); c.rect(5.4, 9.6, 5.2, 1.9); fillStroke(c, "#b8352a", 0.8);
  },
  hide: (c) => {
    const pts = [4, 2, 6, 4, 10, 4, 12, 2, 12.6, 5.2, 14.2, 7.2, 12.6, 9.4, 13, 13.4, 10, 12.2, 8, 14.2, 6, 12.2, 3, 13.4, 3.4, 9.4, 1.8, 7.2, 3.4, 5.2];
    c.beginPath(); c.moveTo(pts[0]!, pts[1]!);
    for (let k = 2; k < pts.length; k += 2) c.lineTo(pts[k]!, pts[k + 1]!);
    c.closePath(); fillStroke(c, "#c88f5f", 1.1);
    c.beginPath(); c.moveTo(6, 7); c.quadraticCurveTo(8, 9, 10, 7); fillStroke(c, null, 0.8, "#9a5a35");
  },
};

/** 在 (x, y) 左上角画一个 size×size 的资源图标；没有这个图标返回 false */
export function drawResIcon(c: Ctx, kind: string, x: number, y: number, size: number): boolean {
  const d = DRAW[kind];
  if (!d) return false;
  c.save();
  c.translate(x, y);
  c.scale(size / 16, size / 16);
  c.lineJoin = "round";
  c.lineCap = "round";
  d(c);
  c.restore();
  return true;
}

export const RES_KINDS = ["coin", "wood", "food", "hide"] as const;
export const RES_ZH: Record<string, string> = { coin: "钱", wood: "木", food: "粮", hide: "兽材" };
