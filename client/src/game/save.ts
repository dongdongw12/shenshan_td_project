/**
 * 存档：只在白天存（夜里有敌人、箭矢、寻路场，状态多且一直在变）。
 * 白天的局面全是纯数据：资源、建筑、家人、天数、广告次数、随机数状态……存成一段 JSON，读档后接着跑结果和没存过完全一样。
 * 网格占用（grid）和寻路场（ffHouse / ffArson）读档时按建筑重建；事件队列清空。
 * 版本号变了（存档结构不兼容）或内容不对就当没有存档。
 */
import type { GameConfig } from "./config";
import { createGame, type Building, type GameState, type Member, type NightStats } from "./sim";

/** 2：2026-11-24 地图改版（溪水挪到谷地右边），旧档里鱼梁可能压在旧河道上，作废 */
export const SAVE_VERSION = 2;

export interface SaveData {
  v: number;
  /** 存档时间（毫秒时间戳，给封面显示“几分钟前”用） */
  savedAt: number;
  rng: number;
  t: number;
  acc: number;
  day: number;
  dayLeft: number;
  nightStartT: number;
  res: GameState["res"];
  houseLevel: GameState["houseLevel"];
  married: boolean;
  houseId: number;
  buildings: Building[];
  members: Member[];
  nextId: number;
  nightLog: NightStats[];
  heroCd: number;
  peddler: boolean;
  ads: GameState["ads"];
}

/** 能不能存：只有白天、场上没有敌人和箭矢时 */
export function canSave(g: GameState): boolean {
  return g.phase === "day" && g.enemies.length === 0 && g.projectiles.length === 0 && g.spawnQueue.length === 0;
}

export function serializeGame(g: GameState, now = Date.now()): SaveData | null {
  if (!canSave(g)) return null;
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  return {
    v: SAVE_VERSION, savedAt: now, rng: g.rng.state,
    t: g.t, acc: g.acc, day: g.day, dayLeft: g.dayLeft, nightStartT: g.nightStartT,
    res: { ...g.res }, houseLevel: g.houseLevel, married: g.married, houseId: g.houseId,
    buildings: clone([...g.buildings.values()]), members: clone(g.members), nextId: g.nextId,
    nightLog: clone(g.nightLog), heroCd: g.heroCd, peddler: g.peddler, ads: clone(g.ads),
  };
}

/** 读档：不合法返回 null（版本不对、缺字段、建筑压在不能建的地方……） */
export function restoreGame(cfg: GameConfig, data: unknown): GameState | null {
  const d = data as Partial<SaveData> | null;
  if (!d || typeof d !== "object" || d.v !== SAVE_VERSION) return null;
  if (!Array.isArray(d.buildings) || !Array.isArray(d.members) || typeof d.day !== "number" || !d.res || typeof d.rng !== "number") return null;
  const g = createGame(cfg, 1);
  // createGame 放了一座初始主屋，清掉，按存档重放
  g.buildings.clear();
  g.grid.occ.fill(0);
  for (const b of d.buildings) {
    if (typeof b?.id !== "number" || !g.grid.inside(b.i, b.j) || !g.grid.inside(b.i + b.w - 1, b.j + b.d - 1)) return null;
    g.buildings.set(b.id, { ...b });
    g.grid.setRect(b.i, b.j, b.w, b.d, b.id);
  }
  if (!g.buildings.has(d.houseId ?? -1)) return null;
  g.rng.state = d.rng;
  Object.assign(g, {
    t: d.t ?? 0, acc: d.acc ?? 0, phase: "day", day: d.day, dayLeft: d.dayLeft ?? cfg.economy.dayLengthS, nightStartT: d.nightStartT ?? 0,
    res: { ...g.res, ...d.res }, houseLevel: d.houseLevel ?? 1, married: !!d.married, houseId: d.houseId,
    members: d.members.map((m) => ({ ...m })), nextId: d.nextId ?? g.nextId, nightLog: d.nightLog ?? [], heroCd: d.heroCd ?? 0,
    peddler: !!d.peddler, ads: { ...g.ads, ...(d.ads ?? {}) },
    enemies: [], projectiles: [], spawnQueue: [], ffHouse: null, ffArson: null, events: [],
    cur: { spawned: 0, fled: 0, lost: 0 },
  });
  return g;
}
