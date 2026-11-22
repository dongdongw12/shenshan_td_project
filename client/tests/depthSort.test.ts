import { describe, expect, it } from "vitest";
import { compareOcclusion, depthSort, footprintRect, pointRect, type Sortable } from "../src/render/depthSort";

const T = 2;
const obj = (key: string, r: ReturnType<typeof footprintRect>, bias = 0): Sortable => ({ key, bias, ...r });
const order = (items: Sortable[]) => depthSort(items).map((s) => s.key);

describe("depthSort", () => {
  // 3×1 长墙：x∈[0,6]、y∈[0,2]，中心深度 x−y = 2
  const wall = obj("wall", footprintRect(0, 0, 3, 1, T));

  it("单位站在长墙左端正前方：中心深度更小（1.5 < 2），但必须画在墙前面", () => {
    const unit = obj("unit", pointRect(1, -0.5));
    expect(compareOcclusion(unit, wall)).toBe(1);
    expect(order([unit, wall])).toEqual(["wall", "unit"]);
  });

  it("单位站在长墙右端正后方：中心深度更大（2.5 > 2），但必须被墙挡住", () => {
    const unit = obj("unit", pointRect(5, 2.5));
    expect(compareOcclusion(unit, wall)).toBe(-1);
    expect(order([wall, unit])).toEqual(["unit", "wall"]);
  });

  it("投影不重叠的物体之间不建立关系（避免 +X+Y 对角的矛盾）", () => {
    const a = obj("a", footprintRect(0, 0, 1, 1, T));
    const b = obj("b", footprintRect(1, 1, 1, 1, T)); // 斜对角，屏幕水平投影只在一点相接
    expect(compareOcclusion(a, b)).toBe(0);
  });

  it("一排房子：靠近相机（+X / −Y）的后画", () => {
    const back = obj("back", footprintRect(0, 2, 2, 2, T));
    const front = obj("front", footprintRect(0, 0, 2, 2, T)); // 更靠 −Y
    const right = obj("right", footprintRect(2, 0, 2, 2, T)); // 更靠 +X
    const out = order([right, front, back]);
    expect(out.indexOf("back")).toBeLessThan(out.indexOf("front"));
    expect(out.indexOf("front")).toBeLessThan(out.indexOf("right"));
  });

  it("bias 高的（特效、飘字）始终在上", () => {
    const fx = obj("fx", pointRect(-5, 9), 1);
    const house = obj("house", footprintRect(-3, 7, 2, 2, T));
    expect(order([fx, house])).toEqual(["house", "fx"]);
  });

  it("单位绕着 2×2 房子走一圈，每一步的先后都与几何关系一致", () => {
    const house = obj("house", footprintRect(1, 1, 2, 2, T)); // x,y ∈ [2,6]
    for (let k = 0; k < 64; k++) {
      const t = (k / 64) * Math.PI * 2;
      const x = 4 + 3 * Math.cos(t), y = 4 + 3 * Math.sin(t);
      const unit = obj("unit", pointRect(x, y));
      const out = order([house, unit]);
      const c = compareOcclusion(unit, house);
      if (c === 1) expect(out).toEqual(["house", "unit"]);
      if (c === -1) expect(out).toEqual(["unit", "house"]);
      // 屏幕水平投影与房子（x+y ∈ [4,12]）重叠时：正前方（y < 2）一定在前，正后方（y > 6）一定在后
      const overlaps = x + y > 4 && x + y < 12;
      if (overlaps && y < 2 && x > 2 && x < 6) expect(c).toBe(1);
      if (overlaps && y > 6 && x > 2 && x < 6) expect(c).toBe(-1);
      if (!overlaps) expect(c).toBe(0);
    }
  });

  it("几百个物体也是稳定的全序（无环、无遗漏）", () => {
    const items: Sortable[] = [];
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) if ((i + j) % 3 === 0) items.push(obj(`b${i}_${j}`, footprintRect(i, j, 1, 1, T)));
    for (let k = 0; k < 200; k++) items.push(obj(`u${k}`, pointRect((k * 7.31) % 24, (k * 3.17) % 24)));
    const out = depthSort(items);
    expect(out.length).toBe(items.length);
    expect(new Set(out.map((s) => s.key)).size).toBe(items.length);
    // 任意有遮挡关系的两者，先后都正确
    const pos = new Map(out.map((s, idx) => [s.key, idx]));
    for (let a = 0; a < items.length; a += 7) {
      for (let b = a + 1; b < items.length; b += 11) {
        const c = compareOcclusion(items[a]!, items[b]!);
        if (c === 1) expect(pos.get(items[a]!.key)!).toBeGreaterThan(pos.get(items[b]!.key)!);
        if (c === -1) expect(pos.get(items[a]!.key)!).toBeLessThan(pos.get(items[b]!.key)!);
      }
    }
  });
});
