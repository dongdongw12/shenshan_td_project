import { describe, expect, it } from "vitest";
import { parseGroundMap, textureBounds } from "../src/render/groundPainter";
import { IsoProjection } from "../src/render/iso";

describe("groundPainter（不依赖画布的部分）", () => {
  it("parseGroundMap：行 = j，列 = i，短行补草地", () => {
    const m = parseGroundMap(["gdw", "f"]);
    expect(m.cols).toBe(3);
    expect(m.rows).toBe(2);
    expect(m.terrain[0]).toEqual(["g", "d", "w"]);
    expect(m.terrain[1]).toEqual(["f", "g", "g"]);
  });

  it("textureBounds 能装下整张地图的四个角，且世界原点落在贴图内", () => {
    const iso = new IsoProjection({ pxPerMeter: 64 });
    const map = parseGroundMap(Array.from({ length: 9 }, () => "gggggggggg"));
    const margin = 20;
    const b = textureBounds(iso, map, margin);
    for (const [x, y] of [[0, 0], [20, 0], [0, 18], [20, 18]] as const) {
      const p = iso.worldToScreen({ x, y });
      const tx = b.origin.x + p.x, ty = b.origin.y + p.y;
      expect(tx).toBeGreaterThanOrEqual(margin - 1e-6);
      expect(ty).toBeGreaterThanOrEqual(margin - 1e-6);
      expect(tx).toBeLessThanOrEqual(b.w - margin + 1);
      expect(ty).toBeLessThanOrEqual(b.h - margin + 1);
    }
    // 10×9 格、64 px/m：宽 = (20+18)·cos45·64 + 2·margin
    expect(b.w).toBe(Math.ceil(38 * Math.SQRT1_2 * 64 + 2 * margin));
  });
});
