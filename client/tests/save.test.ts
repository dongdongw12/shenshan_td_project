import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/game/config";
import { createGame, drainEvents, step, type GameState } from "../src/game/sim";
import { botDay, botFamily } from "../src/game/bot";
import { canSave, restoreGame, serializeGame, SAVE_VERSION } from "../src/game/save";

/** 平衡 AI 玩到第 n 天的白天中段 */
function playTo(day: number, seed = 3): GameState {
  const g = createGame(defaultConfig(), seed);
  let guard = 0;
  while (!(g.day === day && g.phase === "day" && g.dayLeft < g.cfg.economy.dayLengthS - 5) && guard++ < 200000) {
    if (g.phase === "day") { botDay(g); botFamily(g); }
    step(g, 0.5);
    drainEvents(g);
    if (g.phase === "victory" || g.phase === "defeat") break;
  }
  return g;
}

/** 两局要比的东西（不比 cfg / 函数 / 寻路缓存） */
const snapshot = (g: GameState) => JSON.stringify({
  t: g.t.toFixed(3), day: g.day, phase: g.phase, res: g.res, houseLevel: g.houseLevel, married: g.married,
  buildings: [...g.buildings.values()].sort((a, b) => a.id - b.id), members: g.members, nightLog: g.nightLog, rng: g.rng.state,
});

describe("存档", () => {
  it("白天存、读回来一模一样，之后接着跑结果也一样（含夜战）", () => {
    const g = playTo(4);
    expect(g.phase).toBe("day");
    const data = serializeGame(g)!;
    expect(data.v).toBe(SAVE_VERSION);
    const json = JSON.parse(JSON.stringify(data)); // 走一遍真实的存储（字符串）
    const r = restoreGame(g.cfg, json)!;
    expect(r).not.toBeNull();
    expect(snapshot(r)).toBe(snapshot(g));
    // 两局一起再跑 2 天（包括两个夜晚），结果必须一致
    for (let k = 0; k < 2 * (g.cfg.economy.dayLengthS + 200) * 2; k++) {
      for (const x of [g, r]) {
        if (x.phase === "day") { botDay(x); botFamily(x); }
        step(x, 0.5);
        drainEvents(x);
      }
    }
    expect(snapshot(r)).toBe(snapshot(g));
  });

  it("网格占用按建筑重建", () => {
    const g = playTo(3);
    const r = restoreGame(g.cfg, serializeGame(g))!;
    for (const b of r.buildings.values()) expect(r.grid.occupant(b.i, b.j)).toBe(b.id);
    expect(Array.from(r.grid.occ)).toEqual(Array.from(g.grid.occ));
  });

  it("夜里不存；坏档、旧版本当没有", () => {
    const g = playTo(2);
    g.phase = "night";
    expect(canSave(g)).toBe(false);
    expect(serializeGame(g)).toBeNull();
    const cfg = defaultConfig();
    expect(restoreGame(cfg, null)).toBeNull();
    expect(restoreGame(cfg, { v: 999 })).toBeNull();
    expect(restoreGame(cfg, "garbage")).toBeNull();
    const ok = serializeGame(playTo(2))!;
    expect(restoreGame(cfg, { ...ok, houseId: 12345 })).toBeNull();
    expect(restoreGame(cfg, { ...ok, buildings: [{ ...ok.buildings[0]!, i: 999 }] })).toBeNull();
  });
});
