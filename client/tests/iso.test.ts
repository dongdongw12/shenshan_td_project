import { describe, expect, it } from "vitest";
import { IsoProjection } from "../src/render/iso";

describe("IsoProjection（与烘培相机一致）", () => {
  const iso = new IsoProjection({ pxPerMeter: 128, tileSize: 2, elevationDeg: 30 });

  it("一格菱形是 2:1，尺寸与 _meta.json 的 tile_px 一致（362.04 × 181.02）", () => {
    const d = iso.tileDiamond();
    expect(d.w / d.h).toBeCloseTo(2, 6);
    expect(d.w).toBeCloseTo(362.04, 2);
    expect(d.h).toBeCloseTo(181.02, 2);
  });

  it("+X 朝屏幕右下，+Y 朝屏幕右上，+Z 朝屏幕上方", () => {
    const o = iso.worldToScreen({ x: 0, y: 0 });
    const px = iso.worldToScreen({ x: 1, y: 0 });
    const py = iso.worldToScreen({ x: 0, y: 1 });
    const pz = iso.worldToScreen({ x: 0, y: 0, z: 1 });
    expect(px.x).toBeGreaterThan(o.x); expect(px.y).toBeGreaterThan(o.y);
    expect(py.x).toBeGreaterThan(o.x); expect(py.y).toBeLessThan(o.y);
    expect(pz.x).toBeCloseTo(o.x); expect(pz.y).toBeLessThan(o.y);
    // 1m 高度 = cos30° × 128 px
    expect(o.y - pz.y).toBeCloseTo(Math.cos(Math.PI / 6) * 128, 6);
  });

  it("screenToGround 是 worldToScreen 的逆", () => {
    for (const p of [{ x: 3.2, y: -1.5 }, { x: 0, y: 7 }, { x: 11.1, y: 4.4 }]) {
      const back = iso.screenToGround(iso.worldToScreen(p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it("screenToTile 能拾取格子中心所在格", () => {
    for (const [i, j] of [[0, 0], [3, 5], [6, 1]] as const) {
      expect(iso.screenToTile(iso.worldToScreen(iso.tileCenter(i, j)))).toEqual({ i, j });
    }
  });

  it("tileCorners 顺序为 左、上、右、下", () => {
    const [l, t, r, b] = iso.tileCorners(2, 3);
    expect(l.x).toBeLessThan(t.x); expect(t.x).toBeLessThan(r.x);
    expect(t.y).toBeLessThan(l.y); expect(b.y).toBeGreaterThan(r.y);
    expect(t.x).toBeCloseTo(b.x, 6);
  });
});
