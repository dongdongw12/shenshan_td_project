import { describe, expect, it } from "vitest";
import { DayNightClock, lightAlpha, shadowOpacity, staggerDelay } from "../src/render/dayNight";
import { validateAtlas, parseFootprint, type SpriteAtlasIndex } from "../src/render/spriteMeta";

describe("DayNightClock", () => {
  const clock = new DayNightClock({ dayS: 10, duskS: 2, nightS: 6, dawnS: 2 });

  it("各阶段的 nightAlpha", () => {
    clock.t = 5; expect(clock.phase()).toBe("day"); expect(clock.nightAlpha()).toBe(0);
    clock.t = 11; expect(clock.phase()).toBe("dusk"); expect(clock.nightAlpha()).toBeCloseTo(0.5, 6);
    clock.t = 14; expect(clock.phase()).toBe("night"); expect(clock.nightAlpha()).toBe(1);
    clock.t = 19; expect(clock.phase()).toBe("dawn"); expect(clock.nightAlpha()).toBeCloseTo(0.5, 6);
  });

  it("update 按周期循环，setPhase 跳到阶段开头", () => {
    clock.t = 19; clock.update(3); expect(clock.t).toBeCloseTo(2, 6);
    clock.setPhase("night"); expect(clock.t).toBe(12); expect(clock.nightAlpha()).toBe(1);
  });
});

describe("逐户点灯", () => {
  it("延迟越大亮得越晚，夜里全部亮满", () => {
    const early = 0.05, late = 0.4;
    expect(lightAlpha(0.3, early)).toBeGreaterThan(lightAlpha(0.3, late));
    expect(lightAlpha(1, early)).toBe(1);
    expect(lightAlpha(1, late)).toBe(1);
    expect(lightAlpha(0, late)).toBe(0);
  });

  it("staggerDelay 稳定且在范围内、不同 id 有差异", () => {
    const ids = ["house@1,2", "tower@5,4", "pine@0,5", "house@3,3"];
    const ds = ids.map((id) => staggerDelay(id));
    expect(ds).toEqual(ids.map((id) => staggerDelay(id)));
    for (const d of ds) { expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThanOrEqual(0.45); }
    expect(new Set(ds.map((d) => d.toFixed(3))).size).toBe(ids.length);
  });

  it("地影白昼 1、夜晚乘 0.6", () => {
    expect(shadowOpacity(0)).toBe(1);
    expect(shadowOpacity(1)).toBeCloseTo(0.6, 9);
  });
});

describe("spriteMeta", () => {
  it("parseFootprint", () => {
    expect(parseFootprint("2x1")).toEqual({ w: 2, d: 1 });
    expect(parseFootprint("bad")).toEqual({ w: 1, d: 1 });
  });

  it("validateAtlas 能发现比例不一致与锚点越界", () => {
    const base = { tile_size_m: 2, camera_elevation_deg: 30, footprint: "1x1", day_file: "a", night_file: "b" };
    const idx: SpriteAtlasIndex = {
      scale: 0.5, px_per_meter: 64,
      sprites: {
        ok: { ...base, id: "ok", resolution: [100, 100], anchor_px: [50, 80], px_per_meter: 64 },
        badScale: { ...base, id: "badScale", resolution: [100, 100], anchor_px: [50, 80], px_per_meter: 128 },
        badAnchor: { ...base, id: "badAnchor", resolution: [100, 100], anchor_px: [50, 180], px_per_meter: 64 },
      },
    };
    const p = validateAtlas(idx);
    expect(p.some((s) => s.startsWith("badScale"))).toBe(true);
    expect(p.some((s) => s.startsWith("badAnchor"))).toBe(true);
    expect(p.some((s) => s.startsWith("ok"))).toBe(false);
  });
});
