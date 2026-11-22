/**
 * 玩法配置类型 + 默认配置（直接 import JSON，浏览器 / 小游戏 / 单测都能用，打包时内联）。
 * 数值改 client/assets/configs/*.json，然后跑 `npm --prefix client run balance` 看 10 天自动对局结果。
 */
import economyJson from "../../assets/configs/economy.json";
import defenseJson from "../../assets/configs/defense.json";
import enemiesJson from "../../assets/configs/enemies.json";
import familyJson from "../../assets/configs/family.json";
import wavesJson from "../../assets/configs/waves.json";
import mapJson from "../../assets/configs/map_valley01.json";

export type Resource = "coin" | "wood" | "food" | "hide";
export type Cost = Partial<Record<Resource, number>>;

export interface HouseLevel { name: string; hp: number; footprint: string; cost?: Cost; requires?: string; sprite: string }
export interface BuildingDef {
  name: string; footprint: string; cost: Cost; hp: number; sprite: string;
  cycleS?: number; yield?: Cost; walkable?: boolean; terrain?: string; capacity?: number; requires?: string;
  effect?: { productionMul?: number; familyBondMul?: number };
}
export interface TowerDef {
  name: string; footprint: string; hp: number; cost: Cost; sprite: string;
  damage: number; fireRate: number; range: number; projectileSpeed: number;
  armorPierce?: number; splash?: number; burnDps?: number; burnS?: number; stunS?: number;
  garrison: number; upgrade?: string; upgradeOnly?: boolean; requires?: string;
}
export interface WallDef { name: string; footprint: string; hp: number; cost: Cost; sprite: string; upgrade?: string; upgradeOnly?: boolean; requires?: string; garrison?: number }
export interface TrapDef { name: string; footprint: string; cost: Cost; charges: number; damage: number; slow: number; slowS: number; sprite: string }
export interface EnemyDef {
  name: string; hp: number; speed: number; damage: number; attackCd: number; armor: number; radius: number;
  reward: Cost; boss?: boolean; traits?: string[]; burnDps?: number; burnS?: number;
  aura?: { radius: number; speedMul?: number; damageMul?: number };
}
export interface RoleDef {
  name: string; work: string; workMul: number;
  bond: { slot: "tower" | "wall" | "house"; name: string; armorPierce?: number; rangeMul?: number; damageMul?: number; repairPerS?: number; radius?: number; slow?: number; slowS?: number; healPerS?: number };
}
export interface WaveGroup { type: string; count: number; interval: number; delay?: number }
export interface NightDef { night: number; title: string; boss?: string; groups: WaveGroup[]; reward: Cost; hpMul?: number }
export interface MapDef { terrain: string[]; house: { i: number; j: number }; spawns: { i: number; j: number }[] }

export interface GameConfig {
  economy: {
    dayLengthS: number; nightMaxS: number; start: Record<Resource, number>;
    farmer: { woodPerS: number; coinPerS: number };
    upkeep: { foodPerMemberPerDawn: number; starveHpPenalty: number };
    house: Record<"lv1" | "lv2" | "lv3", HouseLevel>;
    buildings: Record<string, BuildingDef>;
    married: { productionMul: number };
  };
  defense: {
    towers: Record<string, TowerDef>;
    walls: Record<string, WallDef>;
    traps: Record<string, TrapDef>;
    pathing: { blockerBaseCost: number; blockerHpCostPer100: number; waterCost: number; roadCost?: number };
    towerCostScale?: number;
  };
  enemies: Record<string, EnemyDef>;
  family: {
    hero: { name: string; damage: number; attackCd: number; guardRadius: number };
    wife: { name: string; nightHealPerS: number };
    garrison: { anyMemberFireRateMul: number };
    growth: { daysToYouth: number };
    birth: { perDawn: number };
    names: string[];
    roles: Record<string, RoleDef>;
  };
  waves: { nights: NightDef[]; endless: { baseNight: number; hpMulPerNight: number; countMulPerNight: number; rewardMulPerNight: number } };
  map: MapDef;
  tileSize: number;
}

/** 去掉以 _ 开头的注释字段 */
function strip<T>(v: T): T {
  if (Array.isArray(v)) return v.map(strip) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!k.startsWith("_")) out[k] = strip(x);
    return out as T;
  }
  return v;
}

export function defaultConfig(): GameConfig {
  return strip({
    economy: economyJson,
    defense: defenseJson,
    enemies: enemiesJson,
    family: familyJson,
    waves: wavesJson,
    map: mapJson,
    tileSize: 2,
  }) as unknown as GameConfig;
}

/** 深拷贝后按路径改数值（平衡调参 / 单测用） */
export function withOverrides(cfg: GameConfig, patch: (c: GameConfig) => void): GameConfig {
  const c = JSON.parse(JSON.stringify(cfg)) as GameConfig;
  patch(c);
  return c;
}

export function parseFp(fp: string): { w: number; d: number } {
  const m = /^(\d+)x(\d+)$/.exec(fp.trim());
  return m ? { w: Number(m[1]), d: Number(m[2]) } : { w: 1, d: 1 };
}
