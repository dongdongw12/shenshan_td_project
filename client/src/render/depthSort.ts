/**
 * 等距遮挡排序（多格建筑 + 移动单位）。
 *
 * 相机从世界 (+X, −Y) 方向看：x 越大、y 越小越靠近相机。
 * 对屏幕上水平投影有重叠的两个物体 A、B（地面占地矩形 [x0,x1]×[y0,y1]，单位米）：
 *   A 在 B 前面  ⇔  A.x0 ≥ B.x1（整体更靠 +X）或 A.y1 ≤ B.y0（整体更靠 −Y）
 * 投影不重叠的物体互不遮挡，不建立先后关系（否则 “+X 且 +Y” 的一对会互相矛盾）。
 * 关系不明确（占地相交，例如单位走进建筑占地）时按中心深度 x − y 决定。
 * 最后做拓扑排序（同层按深度键稳定排序），若出现环则按深度键打断。
 *
 * 简单的“按锚点屏幕 y 排序”在多格建筑旁会出错：站在 2×2 房子右后方的单位锚点 y 可能比房子锚点更大，
 * 却应该被房子挡住。本算法处理这种情况（见 tests/depthSort.test.ts）。
 */

export interface Footprint {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Sortable extends Footprint {
  /** 同深度时的稳定排序键 */
  key: string;
  /** 额外偏置（如特效、飘字始终在上：+1000） */
  bias?: number;
}

const EPS = 1e-6;

function depthKey(s: Sortable): number {
  return (s.x0 + s.x1) / 2 - (s.y0 + s.y1) / 2 + (s.bias ?? 0) * 1e3;
}

/** 返回 1 = a 在前（后画），-1 = b 在前，0 = 无遮挡关系 */
export function compareOcclusion(a: Sortable, b: Sortable): -1 | 0 | 1 {
  // 屏幕水平投影：sx ∝ x + y
  const aMin = a.x0 + a.y0, aMax = a.x1 + a.y1;
  const bMin = b.x0 + b.y0, bMax = b.x1 + b.y1;
  const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  const aPoint = aMax - aMin < EPS, bPoint = bMax - bMin < EPS;
  if (overlap < -EPS) return 0; // 投影分离
  if (overlap <= EPS && !aPoint && !bPoint) return 0; // 两个有面积的物体只在投影边界相接

  if ((a.bias ?? 0) !== (b.bias ?? 0)) return (a.bias ?? 0) > (b.bias ?? 0) ? 1 : -1;
  const aFront = a.x0 >= b.x1 - EPS || a.y1 <= b.y0 + EPS;
  const bFront = b.x0 >= a.x1 - EPS || b.y1 <= a.y0 + EPS;
  if (aFront && !bFront) return 1;
  if (bFront && !aFront) return -1;
  const da = depthKey(a), db = depthKey(b);
  if (Math.abs(da - db) > EPS) return da > db ? 1 : -1;
  return a.key > b.key ? 1 : a.key < b.key ? -1 : 0;
}

/** 返回绘制顺序（先画的在前）。O(n²)，几百个物体每帧可承受；静态建筑可缓存结果。 */
export function depthSort<T extends Sortable>(items: readonly T[]): T[] {
  const n = items.length;
  if (n < 2) return items.slice();
  const after: number[][] = Array.from({ length: n }, () => []); // i 必须在 after[i] 之前画
  const indeg = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = compareOcclusion(items[i]!, items[j]!);
      if (c === 1) { after[j]!.push(i); indeg[i]!++; }
      else if (c === -1) { after[i]!.push(j); indeg[j]!++; }
    }
  }
  const keys = items.map(depthKey);
  const order = (a: number, b: number) =>
    keys[a]! - keys[b]! || (items[a]!.key < items[b]!.key ? -1 : items[a]!.key > items[b]!.key ? 1 : 0);
  const ready: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) ready.push(i);
  const done = new Array<boolean>(n).fill(false);
  const out: T[] = [];
  while (out.length < n) {
    if (ready.length === 0) {
      // 有环：取剩余里深度最小的强行输出
      let pick = -1;
      for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || order(i, pick) < 0)) pick = i;
      ready.push(pick);
      indeg[pick] = 0;
    }
    ready.sort(order);
    const cur = ready.shift()!;
    if (done[cur]) continue;
    done[cur] = true;
    out.push(items[cur]!);
    for (const nx of after[cur]!) {
      if (done[nx]) continue;
      indeg[nx]!--;
      if (indeg[nx] === 0) ready.push(nx);
    }
  }
  return out;
}

/** 占地格 → 世界矩形（米） */
export function footprintRect(i: number, j: number, w: number, d: number, tileSize: number): Footprint {
  return { x0: i * tileSize, x1: (i + w) * tileSize, y0: j * tileSize, y1: (j + d) * tileSize };
}

/** 点状物体（单位、投射物）的占地 */
export function pointRect(x: number, y: number): Footprint {
  return { x0: x, x1: x, y0: y, y1: y };
}
