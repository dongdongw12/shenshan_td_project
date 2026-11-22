/**
 * 地块网格 + 流场寻路（多源 Dijkstra，8 邻接，斜走不能穿墙角）。
 *
 * 塔防的关键取舍：障碍（墙、塔、民房）不是“不可通过”，而是代价很高（基础代价 + 按血量加价）。
 *   → 有路时敌人绕开防御走；路被完全堵死时，敌人会从“最便宜”（最薄弱）的那段障碍砍过去。
 *   玩家可以用篱笆引导/拖延，但堵死并不会让游戏卡住。
 * 只有山石（r）和地图外是真正不可通过的。
 */

export const INF = Number.POSITIVE_INFINITY;

export interface Tile {
  i: number;
  j: number;
}

export class Grid {
  /** 每格占用的实体 id（0 = 空） */
  readonly occ: Int32Array;
  constructor(readonly cols: number, readonly rows: number, readonly terrain: string[][]) {
    this.occ = new Int32Array(cols * rows);
  }

  static fromStrings(lines: string[]): Grid {
    const rows = lines.length;
    const cols = Math.max(...lines.map((l) => l.length));
    return new Grid(cols, rows, lines.map((l) => Array.from({ length: cols }, (_, i) => l[i] ?? "g")));
  }

  inside(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.cols && j < this.rows;
  }

  idx(i: number, j: number): number {
    return j * this.cols + i;
  }

  terrainAt(i: number, j: number): string {
    return this.inside(i, j) ? this.terrain[j]![i]! : "r";
  }

  occupant(i: number, j: number): number {
    return this.inside(i, j) ? this.occ[this.idx(i, j)]! : 0;
  }

  setRect(i: number, j: number, w: number, d: number, id: number): void {
    for (let y = j; y < j + d; y++) for (let x = i; x < i + w; x++) if (this.inside(x, y)) this.occ[this.idx(x, y)] = id;
  }

  rectFree(i: number, j: number, w: number, d: number, allowTerrain: (t: string) => boolean): boolean {
    for (let y = j; y < j + d; y++) {
      for (let x = i; x < i + w; x++) {
        if (!this.inside(x, y) || this.occ[this.idx(x, y)] !== 0 || !allowTerrain(this.terrain[y]![x]!)) return false;
      }
    }
    return true;
  }
}

/** 每格进入代价：INF = 不可通过 */
export type CostFn = (i: number, j: number) => number;

export interface FlowField {
  dist: Float64Array;
  cols: number;
  rows: number;
}

const NB: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** 小顶堆（按距离） */
class Heap {
  private a: [number, number][] = [];
  get size(): number { return this.a.length; }
  push(d: number, k: number): void {
    const a = this.a;
    a.push([d, k]);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (a[p]![0] <= a[c]![0]) break;
      [a[p], a[c]] = [a[c]!, a[p]!];
      c = p;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1, r = l + 1;
        let m = p;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === p) break;
        [a[p], a[m]] = [a[m]!, a[p]!];
        p = m;
      }
    }
    return top;
  }
}

/** 从 goals（距离 0）出发的流场。dist[k] = 从格 k 走到最近目标的总代价。 */
export function buildFlowField(grid: Grid, goals: Tile[], cost: CostFn): FlowField {
  const n = grid.cols * grid.rows;
  const dist = new Float64Array(n).fill(INF);
  const heap = new Heap();
  for (const g of goals) {
    if (!grid.inside(g.i, g.j)) continue;
    const k = grid.idx(g.i, g.j);
    dist[k] = 0;
    heap.push(0, k);
  }
  while (heap.size) {
    const [d, k] = heap.pop();
    if (d > dist[k]!) continue;
    const i = k % grid.cols, j = (k - i) / grid.cols;
    for (const [dx, dy, step] of NB) {
      const ni = i + dx, nj = j + dy;
      if (!grid.inside(ni, nj)) continue;
      // 斜走不能切墙角：两个正交邻格都必须可通过
      if (dx !== 0 && dy !== 0 && (cost(i + dx, j) === INF || cost(i, j + dy) === INF)) continue;
      // 反向流场：从邻格走到当前格的代价 = 进入当前格的代价（目标格本身代价按 1 计）
      const enter = d === 0 ? 1 : cost(i, j);
      if (enter === INF) continue;
      const nk = grid.idx(ni, nj);
      if (cost(ni, nj) === INF) continue;
      const nd = d + step * enter;
      if (nd < dist[nk]!) {
        dist[nk] = nd;
        heap.push(nd, nk);
      }
    }
  }
  return { dist, cols: grid.cols, rows: grid.rows };
}

/** 从 (i,j) 下一步该去哪一格（距离最小的邻格）；已在目标或无路时返回 null */
export function nextStep(ff: FlowField, grid: Grid, i: number, j: number, cost: CostFn): Tile | null {
  if (!grid.inside(i, j)) return null;
  const here = ff.dist[grid.idx(i, j)]!;
  if (here === 0 || here === INF) return null;
  let best: Tile | null = null;
  let bestTotal = INF;
  for (const [dx, dy, step] of NB) {
    const ni = i + dx, nj = j + dy;
    if (!grid.inside(ni, nj)) continue;
    if (dx !== 0 && dy !== 0 && (cost(i + dx, j) === INF || cost(i, j + dy) === INF)) continue;
    const d = ff.dist[grid.idx(ni, nj)]!;
    if (d === INF) continue;
    // 必须算上“走进这一格”的代价：剩余距离小的墙格，进去要付墙的代价（与 buildFlowField 的定义一致）
    const enter = d === 0 ? 1 : cost(ni, nj);
    const total = d + step * enter;
    if (total < bestTotal - 1e-9) {
      bestTotal = total;
      best = { i: ni, j: nj };
    }
  }
  return best;
}

export function distAt(ff: FlowField, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= ff.cols || j >= ff.rows) return INF;
  return ff.dist[j * ff.cols + i]!;
}
