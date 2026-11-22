/**
 * 平衡测试用的“正常玩家”AI：每天按优先级花钱（娶妻 → 经济 → 防御 → 家族），
 * 用简单的几何启发式选位置。它不是最优解，代表“没看攻略、但会玩塔防”的玩家。
 * 数值目标：这个 AI 应该能打通 10 夜，但中后期主屋会掉到 30–80% 血（有压力，不碾压、不崩盘）。
 */
import { parseFp, type GameConfig } from "./config";
import type { Tile } from "./flowField";
import {
  assignWork, build, buildCost, canAfford, sellToPeddler, canBuildAt, garrison, kindInfo, pathFromSpawn, repairAll, repairCost,
  towerStats, upgrade, upgradeHouse, type Building, type GameState,
} from "./sim";

export interface BotOptions {
  /** 每天各类目标数量（按天索引，超出取最后一个） */
  towersByDay: number[];
  farmsByDay: number[];
  trapsPerNight: number;
  fencesNearHouse: number;
  /** 余钱超过 reserveCoin 就继续加塔/升级 */
  greedy: boolean;
  reserveCoin: number;
  sellToPeddler: boolean;
}

export const DEFAULT_BOT: BotOptions = {
  towersByDay: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  farmsByDay: [1, 2, 3, 3, 4, 4, 4, 4, 4, 4],
  trapsPerNight: 2,
  fencesNearHouse: 3,
  greedy: true,
  reserveCoin: 90,
  sellToPeddler: true,
};

const at = <T>(arr: T[], day: number): T => arr[Math.min(arr.length - 1, day - 1)]!;

export function botDay(g: GameState, opt: BotOptions = DEFAULT_BOT): string[] {
  const log: string[] = [];
  const T = g.cfg.tileSize;
  const path = pathFromSpawn(g, 1);
  const pathSet = new Set(path.map((p) => `${p.i},${p.j}`));
  const house = g.buildings.get(g.houseId)!;
  // 为 3×3 大院预留空间、山口与路不建实心建筑
  const reserved = new Set<string>();
  for (let y = house.j; y < house.j + 3; y++) for (let x = house.i; x < house.i + 3; x++) reserved.add(`${x},${y}`);
  const blocked = (i: number, j: number, w: number, d: number, allowPath = false) => {
    for (let y = j; y < j + d; y++) for (let x = i; x < i + w; x++) {
      const k = `${x},${y}`;
      if (reserved.has(k) || (!allowPath && pathSet.has(k))) return true;
    }
    return false;
  };
  const count = (kind: string | ((b: Building) => boolean)) =>
    [...g.buildings.values()].filter((b) => (typeof kind === "string" ? b.kind === kind : kind(b))).length;
  const hc = { x: (house.i + house.w / 2) * T, y: (house.j + house.d / 2) * T };

  const tryBuildBest = (kind: string, score: (i: number, j: number) => number, allowPath = false): boolean => {
    const info = kindInfo(g.cfg, kind);
    if (!info || !canAfford(g, buildCost(g, kind) ?? info.cost)) return false;
    const fp = parseFp(info.footprint);
    let best: Tile | null = null, bestS = -Infinity;
    for (let j = 0; j < g.grid.rows; j++) for (let i = 0; i < g.grid.cols; i++) {
      if (blocked(i, j, fp.w, fp.d, allowPath) || !canBuildAt(g, kind, i, j).ok) continue;
      const s = score(i, j);
      if (s > bestS) { bestS = s; best = { i, j }; }
    }
    if (!best) return false;
    const r = build(g, kind, best.i, best.j);
    if (r.ok) log.push(`建 ${g.cfg.defense.towers[kind]?.name ?? g.cfg.economy.buildings[kind]?.name ?? g.cfg.defense.walls[kind]?.name ?? g.cfg.defense.traps[kind]?.name ?? kind} @${best.i},${best.j}`);
    return r.ok;
  };

  // 塔位评分：射程内覆盖的路格数，偏向靠近主屋的那半段
  const towerScore = (range: number) => (i: number, j: number) => {
    const cx = (i + 0.5) * T, cy = (j + 0.5) * T;
    let cover = 0;
    path.forEach((p, k) => {
      const d = Math.hypot((p.i + 0.5) * T - cx, (p.j + 0.5) * T - cy);
      if (d <= range) cover += 1 + k / path.length; // 越靠近主屋（k 越大）权重越高
    });
    const near = Math.hypot(cx - hc.x, cy - hc.y);
    return cover * 10 - near * 0.2;
  };
  const nearHouse = (i: number, j: number) => -Math.hypot((i + 1) * T - hc.x, (j + 1) * T - hc.y);

  // 正房修好后开始为青砖大院攒木料 / 兽材（不然货郎一来就卖光，永远修不起大院）
  const lv3 = g.cfg.economy.house.lv3.cost ?? {};
  const savingForCourtyard = g.houseLevel === 2 && g.day >= 5;

  // 0) 货郎来了就卖掉结余：留两天口粮、150 木、12 兽材（攒大院时留够大院的量）
  if (opt.sellToPeddler && g.peddler) {
    const mouths = 1 + g.members.length;
    const keep = {
      food: mouths * g.cfg.economy.upkeep.foodPerMemberPerDawn * 2 + 30,
      wood: savingForCourtyard ? Math.max(150, (lv3.wood ?? 0) + 20) : 150,
      hide: savingForCourtyard ? Math.max(12, (lv3.hide ?? 0) + 3) : 12,
    };
    for (const r of ["food", "wood", "hide"] as const) {
      const extra = Math.floor(g.res[r] - keep[r]);
      if (extra > 0 && sellToPeddler(g, r, extra).ok) log.push(`卖给货郎 ${extra}${{ food: "粮", wood: "木", hide: "兽材" }[r]}`);
    }
  }

  let acted = true;
  for (let guard = 0; acted && guard < 40; guard++) {
    acted = false;
    const day = g.day;
    // 1) 娶妻（第一夜后优先）
    if (!g.married && day >= 2 && canAfford(g, g.cfg.economy.house.lv2.cost)) {
      if (upgradeHouse(g).ok) { log.push("修青瓦正房 · 娶妻"); acted = true; continue; }
    }
    // 1b) 大院（第 6 天起，钱粮够了先修大院再花别的）
    if (g.houseLevel === 2 && day >= 6 && canAfford(g, lv3) && upgradeHouse(g).ok) { log.push("扩建青砖大院"); acted = true; continue; }
    // 2) 第一座塔永远最先
    if (count((b) => b.category === "tower") < 1 && tryBuildBest("tower_bamboo", towerScore(8))) { acted = true; continue; }
    // 3) 经济
    if (count("farm_rice") < at(opt.farmsByDay, day) && tryBuildBest("farm_rice", nearHouse)) { acted = true; continue; }
    if (count("fish_weir") < 1 && tryBuildBest("fish_weir", nearHouse)) { acted = true; continue; }
    if (day >= 2 && count("hunt_lodge") < 1 && tryBuildBest("hunt_lodge", nearHouse)) { acted = true; continue; }
    if (g.married && count("wing_room") < (day >= 5 ? 2 : 1) && tryBuildBest("wing_room", nearHouse)) { acted = true; continue; }
    if (g.married && day >= 4 && count("granary") < 1 && tryBuildBest("granary", nearHouse)) { acted = true; continue; }
    // 4) 祠堂（大院修好后）
    if (g.houseLevel === 3 && count("ancestral_hall") < 1 && tryBuildBest("ancestral_hall", nearHouse)) { acted = true; continue; }
    // 5) 防御：塔数量 → 升级 → 特种塔 → 陷阱 → 篱笆/墙
    const towers = [...g.buildings.values()].filter((b) => b.category === "tower");
    if (towers.length < at(opt.towersByDay, day)) {
      const kind = g.married && day >= 4 && count("tower_oil_fire") < Math.min(3, day - 3) ? "tower_oil_fire" : "tower_bamboo";
      if (tryBuildBest(kind, towerScore(8)) || (kind !== "tower_bamboo" && tryBuildBest("tower_bamboo", towerScore(8)))) { acted = true; continue; }
    }
    const up = towers.filter((b) => b.kind === "tower_bamboo").sort((a, b) => towerScore(8)(b.i, b.j) - towerScore(8)(a.i, a.j))[0];
    if (up && day >= 2 && upgrade(g, up.id).ok) { log.push(`升级强弩楼 #${up.id}`); acted = true; continue; }
    if (g.houseLevel === 3 && count("tower_rolling_log") < 1 && tryBuildBest("tower_rolling_log", towerScore(6.5))) { acted = true; continue; }
    if (day >= 2 && count((b) => b.category === "trap") < opt.trapsPerNight) {
      // 陷阱放在路上、离主屋 3~6 格
      if (tryBuildBest("trap_bear", (i, j) => {
        const k = path.findIndex((p) => p.i === i && p.j === j);
        return k < 0 ? -1e9 : -Math.abs(path.length - 1 - k - 4);
      }, true)) { acted = true; continue; }
    }
    if (day >= 2 && count((b) => b.category === "wall") < opt.fencesNearHouse) {
      // 篱笆堵在路上离主屋 2~3 格处，逼敌人停下来砍（塔在后面射）
      if (tryBuildBest("fence_wood", (i, j) => {
        const k = path.findIndex((p) => p.i === i && p.j === j);
        return k < 0 ? -1e9 : -Math.abs(path.length - 1 - k - 2);
      }, true)) { acted = true; continue; }
    }
    if (g.married && day >= 5) {
      const fence = [...g.buildings.values()].find((b) => b.kind === "fence_wood");
      if (fence && upgrade(g, fence.id).ok) { log.push("篱笆→青砖墙"); acted = true; continue; }
    }
    // 6) 修补
    const rc = repairCost(g);
    if ((rc.coin ?? 0) > 0 && canAfford(g, rc) && repairAll(g).ok) { log.push(`修补 ${rc.coin}钱`); acted = true; continue; }
    // 7) 余钱全部变成防御（会玩的玩家不会攒着钱过夜）：先升级，再加塔
    if (opt.greedy && g.res.coin >= opt.reserveCoin) {
      const up2 = [...g.buildings.values()].find((b) => b.kind === "tower_bamboo");
      if (up2 && upgrade(g, up2.id).ok) { log.push(`升级强弩楼 #${up2.id}`); acted = true; continue; }
      const kind = g.married && day >= 4 && g.res.hide >= 3 && g.res.wood >= 40 ? "tower_oil_fire" : "tower_bamboo";
      if (tryBuildBest(kind, towerScore(8)) || tryBuildBest("tower_bamboo", towerScore(8))) { acted = true; continue; }
    }
  }

  log.push(...botFamily(g, towerScore));
  return log;
}

/** 家族自动安排：子女轮流分工（猎/樵/渔/耕）；长成的少年按身份驻守到最合适的位置 */
export function botFamily(g: GameState, towerScore?: (range: number) => (i: number, j: number) => number): string[] {
  const log: string[] = [];
  const score = towerScore ?? (() => () => 0);
  const rotation = ["hunt_lodge", "farmer", "fish_weir", "farm_rice"];
  g.members.filter((m) => m.kind === "child").forEach((m, k) => { if (!m.role) assignWork(g, m.id, rotation[k % rotation.length]!); });
  const towersByCover = [...g.buildings.values()].filter((b) => b.category === "tower")
    .sort((a, b) => score(towerStats(g, b).range)(b.i, b.j) - score(towerStats(g, a).range)(a.i, a.j));
  for (const m of g.members) {
    if (!m.role || m.post !== null) continue;
    const slot = g.cfg.family.roles[m.role]!.bond.slot;
    const post = slot === "house" ? g.houseId
      : slot === "wall" ? [...g.buildings.values()].find((b) => b.category === "wall" && !g.members.some((x) => x.post === b.id))?.id
      : towersByCover.find((b) => g.members.filter((x) => x.post === b.id).length < g.cfg.defense.towers[b.kind]!.garrison)?.id;
    if (post !== undefined && garrison(g, m.id, post).ok) log.push(`${m.name}（${g.cfg.family.roles[m.role]!.name}）驻守 #${post}`);
  }
  return log;
}

export interface BalanceRow {
  night: number; survived: boolean; houseHpPct: number; spawned: number; fled: number; lost: number;
  towers: number; coin: number; wood: number; food: number; hide: number; family: number; actions: string[];
}

/** 用 AI 自动打一局，返回每夜一行（平衡表） */
export async function autoPlay(cfgOrGame: GameConfig | GameState, nights = 10, opt: BotOptions = DEFAULT_BOT, seed = 7): Promise<BalanceRow[]> {
  const { createGame, runUntilPhaseChange, drainEvents, step } = await import("./sim");
  const runFor = (gs: GameState, s: number) => {
    const day = gs.day, ph = gs.phase;
    for (let t = 0; t < s && gs.phase === ph && gs.day === day; t += 0.5) step(gs, 0.5);
  };
  const g = "grid" in cfgOrGame ? cfgOrGame : createGame(cfgOrGame, seed);
  const rows: BalanceRow[] = [];
  while (g.phase === "day" && g.day <= nights) {
    // 白天每 4 秒花一次钱（真实玩家边攒边建），白天结束自动入夜
    const actions: string[] = [];
    const day = g.day;
    while (g.phase === "day" && g.day === day) {
      actions.push(...botDay(g, opt));
      runFor(g, 4);
    }
    if (g.phase === "day") continue;
    runUntilPhaseChange(g, 400);        // 夜晚
    drainEvents(g);
    const log = g.nightLog[g.nightLog.length - 1]!;
    rows.push({
      night: log.night, survived: log.survived, houseHpPct: log.houseHpPct, spawned: log.spawned, fled: log.fled, lost: log.buildingsLost,
      towers: [...g.buildings.values()].filter((b) => b.category === "tower").length,
      coin: Math.round(g.res.coin), wood: Math.round(g.res.wood), food: Math.round(g.res.food), hide: Math.round(g.res.hide),
      family: g.members.length, actions,
    });
    if (!log.survived) break;
  }
  return rows;
}
