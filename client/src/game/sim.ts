/**
 * 《深山传家》玩法核心模拟（引擎无关、确定性）。
 *
 * 一天 = 白昼（生产、建造、娶妻生子）→ 夜晚（波次塔防）→ 黎明结算（奖励、口粮、长大添丁、修补）。
 * 第 10 夜击退大当家即通关，之后可继续无尽模式。
 *
 * 用法：
 *   const g = createGame(defaultConfig(), seed);
 *   build(g, "tower_bamboo", i, j); marry(g); startNight(g);
 *   step(g, dt);               // 内部按 1/30 秒定步长推进，同种子同指令 → 同结果
 *   g.events                   // 本帧事件（出怪、射击、击退、建筑被毁、添丁……），渲染/音效层消费后清空
 *
 * 坐标与渲染层一致：世界米，1 格 = cfg.tileSize 米，格 (i,j) 覆盖 x∈[i·t,(i+1)·t]、y∈[j·t,(j+1)·t]。
 */
import { parseFp, type Cost, type EnemyDef, type GameConfig, type NightDef, type Resource, type TowerDef } from "./config";
import { buildFlowField, distAt, Grid, INF, nextStep, type FlowField, type Tile } from "./flowField";
import { Rng } from "./rng";

export const FIXED_DT = 1 / 30;

export type Phase = "day" | "night" | "victory" | "defeat";
export type Category = "house" | "production" | "tower" | "wall" | "trap";

export interface Building {
  id: number;
  kind: string;
  category: Category;
  i: number; j: number; w: number; d: number;
  hp: number; maxHp: number;
  walkable: boolean;
  cycleT: number;
  cooldown: number;
  charges: number;
  burnUntil: number; burnDps: number;
}

export interface Enemy {
  id: number;
  type: string;
  def: EnemyDef;
  x: number; y: number;
  hp: number; maxHp: number;
  cd: number;
  slowUntil: number; slowMul: number;
  stunUntil: number;
  burnUntil: number; burnDps: number;
  goal: "house" | "arson";
  attacking: number;
  trapsHit: number[];
}

export interface Projectile {
  towerId: number; targetId: number;
  x: number; y: number;
  eta: number;
  damage: number; pierce: number; splash: number;
  burnDps: number; burnS: number; slow: number; slowS: number; stunS: number;
}

export interface Member {
  id: number;
  name: string;
  kind: "wife" | "child";
  bornDay: number;
  role: string | null;
  work: string;
  post: number | null;
}

export type GameEvent =
  | { type: "dayStart"; day: number }
  | { type: "nightStart"; night: number; title: string }
  | { type: "spawn"; id: number; enemy: string; x: number; y: number }
  | { type: "shot"; tower: number; target: number; x: number; y: number }
  | { type: "hit"; target: number; damage: number; x: number; y: number }
  | { type: "enemyFled"; id: number; enemy: string; x: number; y: number; reward: Cost }
  | { type: "buildingHit"; id: number; damage: number }
  | { type: "buildingDestroyed"; id: number; kind: string }
  | { type: "built"; id: number; kind: string; i: number; j: number }
  | { type: "married" }
  | { type: "birth"; member: number; name: string }
  | { type: "grownUp"; member: number; name: string; role: string }
  | { type: "dawn"; night: number; reward: Cost; starved: boolean }
  | { type: "victory" }
  | { type: "defeat"; night: number };

export interface NightStats {
  night: number;
  survived: boolean;
  houseHpPct: number;
  spawned: number;
  fled: number;
  buildingsLost: number;
  durationS: number;
}

export interface GameState {
  cfg: GameConfig;
  rng: Rng;
  grid: Grid;
  t: number;
  acc: number;
  phase: Phase;
  day: number;
  dayLeft: number;
  nightStartT: number;
  res: Record<Resource, number>;
  houseLevel: 1 | 2 | 3;
  married: boolean;
  houseId: number;
  buildings: Map<number, Building>;
  enemies: Enemy[];
  projectiles: Projectile[];
  members: Member[];
  spawnQueue: { at: number; type: string }[];
  ffHouse: FlowField | null;
  ffArson: FlowField | null;
  nextId: number;
  events: GameEvent[];
  nightLog: NightStats[];
  cur: { spawned: number; fled: number; lost: number };
  heroCd: number;
}

// ============================================================================ 创建

export function createGame(cfg: GameConfig, seed = 1): GameState {
  const grid = Grid.fromStrings(cfg.map.terrain);
  const g: GameState = {
    cfg, rng: new Rng(seed), grid,
    t: 0, acc: 0, phase: "day", day: 1, dayLeft: cfg.economy.dayLengthS, nightStartT: 0,
    res: { ...cfg.economy.start },
    houseLevel: 1, married: false, houseId: 0,
    buildings: new Map(), enemies: [], projectiles: [], members: [], spawnQueue: [],
    ffHouse: null, ffArson: null, nextId: 1, events: [], nightLog: [],
    cur: { spawned: 0, fled: 0, lost: 0 },
    heroCd: 0,
  };
  const h = cfg.economy.house.lv1;
  const fp = parseFp(h.footprint);
  const house = addBuilding(g, "house", "house", cfg.map.house.i, cfg.map.house.j, fp.w, fp.d, h.hp, false);
  g.houseId = house.id;
  g.events.push({ type: "dayStart", day: 1 });
  return g;
}

function addBuilding(g: GameState, kind: string, category: Category, i: number, j: number, w: number, d: number, hp: number, walkable: boolean): Building {
  const b: Building = { id: g.nextId++, kind, category, i, j, w, d, hp, maxHp: hp, walkable, cycleT: 0, cooldown: 0, charges: 0, burnUntil: 0, burnDps: 0 };
  g.buildings.set(b.id, b);
  g.grid.setRect(i, j, w, d, b.id);
  g.ffHouse = g.ffArson = null;
  return b;
}

function removeBuilding(g: GameState, b: Building): void {
  g.buildings.delete(b.id);
  g.grid.setRect(b.i, b.j, b.w, b.d, 0);
  for (const m of g.members) if (m.post === b.id) m.post = null;
  g.ffHouse = g.ffArson = null;
}

// ============================================================================ 资源

export function canAfford(g: GameState, c: Cost | undefined): boolean {
  if (!c) return true;
  return (Object.keys(c) as Resource[]).every((k) => g.res[k] >= (c[k] ?? 0));
}

function pay(g: GameState, c: Cost | undefined): void {
  if (!c) return;
  for (const k of Object.keys(c) as Resource[]) g.res[k] -= c[k] ?? 0;
}

function gain(g: GameState, c: Cost | undefined, mul = 1): void {
  if (!c) return;
  for (const k of Object.keys(c) as Resource[]) g.res[k] += (c[k] ?? 0) * mul;
}

// ============================================================================ 指令（玩家 / AI 调用）

export type BuildKind = string;

interface KindInfo { category: Category; footprint: string; hp: number; cost: Cost; walkable: boolean; requires?: string; terrain?: string; upgradeOnly?: boolean }

/** 实际建造价格（塔按已拥有数量递增） */
export function buildCost(g: GameState, kind: BuildKind): Cost | null {
  const info = kindInfo(g.cfg, kind);
  if (!info) return null;
  if (info.category !== "tower" || !g.cfg.defense.towerCostScale) return info.cost;
  const owned = [...g.buildings.values()].filter((b) => b.category === "tower").length;
  const mul = 1 + g.cfg.defense.towerCostScale * owned;
  return Object.fromEntries(Object.entries(info.cost).map(([k, v]) => [k, Math.round((v ?? 0) * mul)])) as Cost;
}

export function kindInfo(cfg: GameConfig, kind: BuildKind): KindInfo | null {
  const e = cfg.economy.buildings[kind];
  if (e) return { category: "production", footprint: e.footprint, hp: e.hp, cost: e.cost, walkable: !!e.walkable, requires: e.requires, terrain: e.terrain };
  const t = cfg.defense.towers[kind];
  if (t) return { category: "tower", footprint: t.footprint, hp: t.hp, cost: t.cost, walkable: false, requires: t.requires, upgradeOnly: t.upgradeOnly };
  const w = cfg.defense.walls[kind];
  if (w) return { category: "wall", footprint: w.footprint, hp: w.hp, cost: w.cost, walkable: false, requires: w.requires, upgradeOnly: w.upgradeOnly };
  const tr = cfg.defense.traps[kind];
  if (tr) return { category: "trap", footprint: tr.footprint, hp: 1, cost: tr.cost, walkable: true };
  return null;
}

function requirementMet(g: GameState, req: string | undefined): boolean {
  if (!req) return true;
  if (req === "married") return g.married;
  if (req === "lv2") return g.houseLevel >= 2;
  if (req === "lv3") return g.houseLevel >= 3;
  return true;
}

export type CmdResult = { ok: true; id?: number } | { ok: false; reason: string };

export function canBuildAt(g: GameState, kind: BuildKind, i: number, j: number): CmdResult {
  const info = kindInfo(g.cfg, kind);
  if (!info) return { ok: false, reason: `未知建筑 ${kind}` };
  if (info.upgradeOnly) return { ok: false, reason: "只能由升级得到" };
  if (!requirementMet(g, info.requires)) return { ok: false, reason: `需要 ${info.requires}` };
  const fp = parseFp(info.footprint);
  const okTerrain = (t: string) => (info.terrain ? t === info.terrain : t !== "r" && t !== "w");
  if (!g.grid.rectFree(i, j, fp.w, fp.d, okTerrain)) return { ok: false, reason: "位置被占或地形不允许" };
  // 出怪口不许直接堵
  for (const s of g.cfg.map.spawns) if (s.i >= i && s.i < i + fp.w && s.j >= j && s.j < j + fp.d) return { ok: false, reason: "不能堵在山口" };
  return { ok: true };
}

export function build(g: GameState, kind: BuildKind, i: number, j: number): CmdResult {
  if (g.phase !== "day") return { ok: false, reason: "只能在白天建造" };
  const can = canBuildAt(g, kind, i, j);
  if (!can.ok) return can;
  const info = kindInfo(g.cfg, kind)!;
  const cost = buildCost(g, kind)!;
  if (!canAfford(g, cost)) return { ok: false, reason: "钱粮不够" };
  pay(g, cost);
  const fp = parseFp(info.footprint);
  const b = addBuilding(g, kind, info.category, i, j, fp.w, fp.d, info.hp, info.walkable);
  if (info.category === "trap") b.charges = g.cfg.defense.traps[kind]!.charges;
  g.events.push({ type: "built", id: b.id, kind, i, j });
  return { ok: true, id: b.id };
}

/** 塔 / 墙升级（竹箭楼→强弩楼、篱笆→青砖墙） */
export function upgrade(g: GameState, id: number): CmdResult {
  if (g.phase !== "day") return { ok: false, reason: "只能在白天升级" };
  const b = g.buildings.get(id);
  if (!b) return { ok: false, reason: "没有这个建筑" };
  const from = g.cfg.defense.towers[b.kind] ?? g.cfg.defense.walls[b.kind];
  const to = from?.upgrade;
  if (!to) return { ok: false, reason: "不能升级" };
  const def = g.cfg.defense.towers[to] ?? g.cfg.defense.walls[to];
  if (!def) return { ok: false, reason: "升级目标不存在" };
  if (!requirementMet(g, def.requires)) return { ok: false, reason: `需要 ${def.requires}` };
  if (!canAfford(g, def.cost)) return { ok: false, reason: "钱粮不够" };
  pay(g, def.cost);
  const ratio = b.hp / b.maxHp;
  b.kind = to;
  b.maxHp = def.hp;
  b.hp = Math.max(1, Math.round(def.hp * ratio));
  g.ffHouse = g.ffArson = null;
  return { ok: true, id: b.id };
}

/** 修房：lv1→lv2 即娶妻；lv2→lv3 青砖大院（占地变 3×3，需要周围空出来） */
export function upgradeHouse(g: GameState): CmdResult {
  if (g.phase !== "day") return { ok: false, reason: "只能在白天修房" };
  const house = g.buildings.get(g.houseId)!;
  const next = g.houseLevel === 1 ? g.cfg.economy.house.lv2 : g.houseLevel === 2 ? g.cfg.economy.house.lv3 : null;
  if (!next) return { ok: false, reason: "已是最高等级" };
  if (!canAfford(g, next.cost)) return { ok: false, reason: "钱粮不够" };
  const fp = parseFp(next.footprint);
  if (fp.w !== house.w || fp.d !== house.d) {
    g.grid.setRect(house.i, house.j, house.w, house.d, 0);
    const ok = g.grid.rectFree(house.i, house.j, fp.w, fp.d, (t) => t !== "r" && t !== "w");
    g.grid.setRect(house.i, house.j, house.w, house.d, house.id);
    if (!ok) return { ok: false, reason: "大院占地 3×3，周围要先空出来" };
    g.grid.setRect(house.i, house.j, fp.w, fp.d, house.id);
    house.w = fp.w; house.d = fp.d;
  }
  pay(g, next.cost);
  const ratio = house.hp / house.maxHp;
  house.maxHp = next.hp;
  house.hp = Math.round(next.hp * Math.max(ratio, 0.5));
  g.houseLevel = (g.houseLevel + 1) as 2 | 3;
  g.ffHouse = g.ffArson = null;
  if (g.houseLevel === 2 && !g.married) {
    g.married = true;
    g.members.push({ id: g.nextId++, name: g.cfg.family.wife.name, kind: "wife", bornDay: g.day, role: null, work: "farm_rice", post: null });
    g.events.push({ type: "married" });
  }
  return { ok: true };
}

export const marry = upgradeHouse;

export function assignWork(g: GameState, memberId: number, work: string): CmdResult {
  const m = g.members.find((x) => x.id === memberId);
  if (!m || m.kind !== "child") return { ok: false, reason: "只能给子女分工" };
  if (m.role) return { ok: false, reason: "已长大定了身份" };
  m.work = work;
  return { ok: true };
}

export function isYouth(m: Member): boolean {
  return m.kind === "child" && m.role !== null;
}

/** 驻守：塔（神射手/撒网）、墙（修墙）、主屋（送饭）。postId = null 撤下 */
export function garrison(g: GameState, memberId: number, postId: number | null): CmdResult {
  const m = g.members.find((x) => x.id === memberId);
  if (!m || !isYouth(m)) return { ok: false, reason: "只有长成少年的子女能驻守" };
  if (postId === null) { m.post = null; return { ok: true }; }
  const b = g.buildings.get(postId);
  if (!b) return { ok: false, reason: "没有这个建筑" };
  const cap = b.category === "tower" ? g.cfg.defense.towers[b.kind]!.garrison
    : b.category === "wall" ? 1 : b.category === "house" ? 4 : 0;
  const used = g.members.filter((x) => x.post === postId && x.id !== memberId).length;
  if (used >= cap) return { ok: false, reason: "驻守位已满" };
  m.post = postId;
  return { ok: true };
}

export function repairCost(g: GameState): Cost {
  let missing = 0;
  for (const b of g.buildings.values()) if (b.category !== "trap") missing += b.maxHp - b.hp;
  return { coin: Math.ceil(missing * 0.08), wood: Math.ceil(missing * 0.04) };
}

export function repairAll(g: GameState): CmdResult {
  if (g.phase !== "day") return { ok: false, reason: "只能在白天修补" };
  const c = repairCost(g);
  if (!canAfford(g, c)) return { ok: false, reason: "钱粮不够" };
  pay(g, c);
  for (const b of g.buildings.values()) b.hp = b.maxHp;
  return { ok: true };
}

export function startNight(g: GameState): CmdResult {
  if (g.phase !== "day") return { ok: false, reason: "不是白天" };
  const night = nightDef(g.cfg, g.day);
  g.phase = "night";
  g.nightStartT = g.t;
  g.cur = { spawned: 0, fled: 0, lost: 0 };
  let at = g.t + 1.5;
  for (const grp of night.groups) {
    at += grp.delay ?? 0; // delay 相对上一组开始的时间
    for (let k = 0; k < grp.count; k++) g.spawnQueue.push({ at: at + k * grp.interval, type: grp.type });
  }
  g.spawnQueue.sort((a, b) => a.at - b.at);
  g.events.push({ type: "nightStart", night: g.day, title: night.title });
  return { ok: true };
}

/** 第 n 夜的波次（>10 按无尽倍率放大第 10 夜） */
export function nightDef(cfg: GameConfig, n: number): NightDef & { hpMul: number } {
  const list = cfg.waves.nights;
  if (n <= list.length) return { ...list[n - 1]!, hpMul: list[n - 1]!.hpMul ?? 1 };
  const e = cfg.waves.endless;
  const k = n - e.baseNight;
  const base = list[list.length - 1]!;
  return {
    ...base,
    night: n,
    title: `无尽 · 第${n}夜`,
    groups: base.groups.map((gp) => ({ ...gp, count: Math.round(gp.count * e.countMulPerNight ** k) })),
    reward: Object.fromEntries(Object.entries(base.reward).map(([r, v]) => [r, Math.round((v ?? 0) * e.rewardMulPerNight ** k)])),
    hpMul: (base.hpMul ?? 1) * e.hpMulPerNight ** k,
  };
}

// ============================================================================ 主循环

export function step(g: GameState, dt: number): void {
  g.acc += dt;
  while (g.acc >= FIXED_DT) {
    g.acc -= FIXED_DT;
    tick(g, FIXED_DT);
  }
}

/** 一直推进到阶段改变（白天结束 / 黎明 / 胜负），用于 AI 与平衡对局 */
export function runUntilPhaseChange(g: GameState, maxS = 600): void {
  const start = g.phase, startDay = g.day;
  let s = 0;
  while (s < maxS && g.phase === start && g.day === startDay) {
    tick(g, FIXED_DT);
    s += FIXED_DT;
  }
}

function tick(g: GameState, dt: number): void {
  if (g.phase === "victory" || g.phase === "defeat") return;
  g.t += dt;
  if (g.phase === "day") {
    tickDay(g, dt);
    g.dayLeft -= dt;
    if (g.dayLeft <= 0) startNight(g);
    return;
  }
  // 夜晚
  ensureFlowFields(g);
  spawn(g);
  tickEnemies(g, dt);
  tickTowers(g, dt);
  tickProjectiles(g, dt);
  tickBurn(g, dt);
  tickFamilyNight(g, dt);
  tickHero(g, dt);
  const house = g.buildings.get(g.houseId);
  if (!house || house.hp <= 0) {
    endNight(g, false);
    return;
  }
  const timeout = g.t - g.nightStartT > g.cfg.economy.nightMaxS;
  if ((g.spawnQueue.length === 0 && g.enemies.length === 0) || timeout) endNight(g, true);
}

// ============================================================================ 白昼：生产

export function productionMul(g: GameState, kind: string): number {
  let mul = g.married ? g.cfg.economy.married.productionMul : 1;
  for (const b of g.buildings.values()) {
    const eff = g.cfg.economy.buildings[b.kind]?.effect;
    if (eff?.productionMul) mul *= eff.productionMul;
  }
  let workers = 0;
  for (const m of g.members) {
    if (m.kind !== "child" || m.post !== null || m.work !== kind) continue;
    workers += m.role ? g.cfg.family.roles[m.role]!.workMul - 1 : 0.15;
  }
  return mul * (1 + workers);
}

function tickDay(g: GameState, dt: number): void {
  const f = g.cfg.economy.farmer;
  const fm = productionMul(g, "farmer") / (g.married ? g.cfg.economy.married.productionMul : 1);
  g.res.wood += f.woodPerS * dt * fm;
  g.res.coin += f.coinPerS * dt * fm;
  for (const b of g.buildings.values()) {
    const def = g.cfg.economy.buildings[b.kind];
    if (!def?.cycleS || !def.yield) continue;
    b.cycleT += dt;
    if (b.cycleT >= def.cycleS) {
      b.cycleT -= def.cycleS;
      gain(g, def.yield, productionMul(g, b.kind));
    }
  }
}

// ============================================================================ 夜晚：寻路与敌人

function tileCost(g: GameState) {
  const p = g.cfg.defense.pathing;
  return (i: number, j: number): number => {
    const t = g.grid.terrainAt(i, j);
    if (t === "r") return INF;
    const id = g.grid.occupant(i, j);
    if (id) {
      const b = g.buildings.get(id);
      if (b && !b.walkable) return p.blockerBaseCost + (b.hp / 100) * p.blockerHpCostPer100;
    }
    return t === "w" ? p.waterCost : t === "d" ? p.roadCost ?? 1 : 1;
  };
}

function footprintTiles(b: Building): Tile[] {
  const out: Tile[] = [];
  for (let y = b.j; y < b.j + b.d; y++) for (let x = b.i; x < b.i + b.w; x++) out.push({ i: x, j: y });
  return out;
}

/** 取流场（建筑被毁/新建后会被置空，这里按需重建，同一 tick 内也安全） */
function flow(g: GameState, goal: "house" | "arson"): FlowField {
  ensureFlowFields(g);
  return goal === "arson" ? g.ffArson! : g.ffHouse!;
}

function ensureFlowFields(g: GameState): void {
  if (g.ffHouse && g.ffArson) return;
  const cost = tileCost(g);
  const house = g.buildings.get(g.houseId);
  g.ffHouse = buildFlowField(g.grid, house ? footprintTiles(house) : [], cost);
  const prod = [...g.buildings.values()].filter((b) => b.category === "production");
  g.ffArson = prod.length ? buildFlowField(g.grid, prod.flatMap(footprintTiles), cost) : g.ffHouse;
}

function spawn(g: GameState): void {
  const night = nightDef(g.cfg, g.day);
  while (g.spawnQueue.length && g.spawnQueue[0]!.at <= g.t) {
    const s = g.spawnQueue.shift()!;
    const def = g.cfg.enemies[s.type];
    if (!def) continue;
    const sp = g.rng.pick(g.cfg.map.spawns);
    const T = g.cfg.tileSize;
    const hp = Math.round(def.hp * night.hpMul);
    const e: Enemy = {
      id: g.nextId++, type: s.type, def,
      x: (sp.i + 0.5) * T + g.rng.range(-0.4, 0.4), y: (sp.j + 0.5) * T + g.rng.range(-0.4, 0.4),
      hp, maxHp: hp, cd: 0, slowUntil: 0, slowMul: 1, stunUntil: 0, burnUntil: 0, burnDps: 0,
      goal: def.traits?.includes("arson") ? "arson" : "house", attacking: 0, trapsHit: [],
    };
    g.enemies.push(e);
    g.cur.spawned++;
    g.events.push({ type: "spawn", id: e.id, enemy: e.type, x: e.x, y: e.y });
  }
}

function auraFor(g: GameState, e: Enemy): { speedMul: number; damageMul: number } {
  let speedMul = 1, damageMul = 1;
  for (const o of g.enemies) {
    const a = o.def.aura;
    if (!a || o === e) continue;
    if (Math.hypot(o.x - e.x, o.y - e.y) <= a.radius) {
      speedMul = Math.max(speedMul, a.speedMul ?? 1);
      damageMul = Math.max(damageMul, a.damageMul ?? 1);
    }
  }
  return { speedMul, damageMul };
}

/** 敌人中心到建筑占地矩形的距离（米） */
function distToRect(x: number, y: number, b: Building, T: number): number {
  const dx = Math.max(b.i * T - x, 0, x - (b.i + b.w) * T);
  const dy = Math.max(b.j * T - y, 0, y - (b.j + b.d) * T);
  return Math.hypot(dx, dy);
}

function tickEnemies(g: GameState, dt: number): void {
  const T = g.cfg.tileSize;
  const cost = tileCost(g);
  for (const e of g.enemies) {
    if (e.stunUntil > g.t) continue;
    const aura = auraFor(g, e);
    // 正在砍的建筑还在、且够得着 → 继续砍
    let target = e.attacking ? g.buildings.get(e.attacking) : undefined;
    if (target && distToRect(e.x, e.y, target, T) > e.def.radius + 0.35) target = undefined;
    if (!target) {
      e.attacking = 0;
      const ff = flow(g, e.goal);
      const ti = Math.floor(e.x / T), tj = Math.floor(e.y / T);
      const here = g.grid.occupant(ti, tj);
      const hereB = here ? g.buildings.get(here) : undefined;
      if (distAt(ff, ti, tj) === 0 && hereB) {
        target = hereB; // 站在目标（可走的田地）上：就地放火/破坏
      } else {
        const nx = nextStep(ff, g.grid, ti, tj, cost);
        if (!nx) continue;
        const occ = g.grid.occupant(nx.i, nx.j);
        const ob = occ ? g.buildings.get(occ) : undefined;
        if (ob && !ob.walkable) {
          if (distToRect(e.x, e.y, ob, T) <= e.def.radius + 0.3) target = ob;
          else moveToward(e, (nx.i + 0.5) * T, (nx.j + 0.5) * T, effSpeed(g, e, aura.speedMul) * dt);
        } else {
          moveToward(e, (nx.i + 0.5) * T, (nx.j + 0.5) * T, effSpeed(g, e, aura.speedMul) * dt);
          checkTrap(g, e, nx);
        }
      }
    }
    if (target) {
      e.attacking = target.id;
      e.cd -= dt;
      if (e.cd <= 0) {
        e.cd = e.def.attackCd;
        damageBuilding(g, target, e.def.damage * aura.damageMul);
        if (e.def.traits?.includes("arson") && e.def.burnDps) {
          target.burnDps = Math.max(target.burnDps, e.def.burnDps);
          target.burnUntil = g.t + (e.def.burnS ?? 4);
        }
      }
    }
  }
}

function effSpeed(g: GameState, e: Enemy, auraMul: number): number {
  return e.def.speed * auraMul * (e.slowUntil > g.t ? e.slowMul : 1);
}

function moveToward(e: Enemy, tx: number, ty: number, maxStep: number): void {
  const dx = tx - e.x, dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  if (d <= maxStep || d < 1e-6) { e.x = tx; e.y = ty; return; }
  e.x += (dx / d) * maxStep;
  e.y += (dy / d) * maxStep;
}

function checkTrap(g: GameState, e: Enemy, t: Tile): void {
  const id = g.grid.occupant(t.i, t.j);
  const b = id ? g.buildings.get(id) : undefined;
  if (!b || b.category !== "trap" || e.trapsHit.includes(b.id)) return;
  const def = g.cfg.defense.traps[b.kind]!;
  e.trapsHit.push(b.id);
  damageEnemy(g, e, def.damage, 0);
  applySlow(g, e, 1 - def.slow, def.slowS);
  b.charges--;
  if (b.charges <= 0) removeBuilding(g, b);
}

function damageBuilding(g: GameState, b: Building, dmg: number): void {
  b.hp -= dmg;
  g.events.push({ type: "buildingHit", id: b.id, damage: dmg });
  if (b.hp <= 0) {
    if (b.id === g.houseId) { b.hp = 0; return; }
    removeBuilding(g, b);
    g.cur.lost++;
    g.events.push({ type: "buildingDestroyed", id: b.id, kind: b.kind });
    for (const e of g.enemies) if (e.attacking === b.id) e.attacking = 0;
  }
}

function applySlow(g: GameState, e: Enemy, mul: number, s: number): void {
  if (e.slowUntil > g.t) e.slowMul = Math.min(e.slowMul, mul);
  else e.slowMul = mul;
  e.slowUntil = Math.max(e.slowUntil, g.t + s);
}

function damageEnemy(g: GameState, e: Enemy, dmg: number, pierce: number): void {
  if (e.hp <= 0) return;
  const eff = Math.max(1, dmg - e.def.armor * (1 - Math.min(1, pierce)));
  e.hp -= eff;
  g.events.push({ type: "hit", target: e.id, damage: eff, x: e.x, y: e.y });
  if (e.hp <= 0) {
    gain(g, e.def.reward);
    g.cur.fled++;
    g.events.push({ type: "enemyFled", id: e.id, enemy: e.type, x: e.x, y: e.y, reward: e.def.reward });
  }
}

// ============================================================================ 夜晚：塔与投射物

export interface TowerStats { damage: number; fireRate: number; range: number; pierce: number; slow: number; slowS: number; splash: number; burnDps: number; burnS: number; stunS: number; projectileSpeed: number }

export function towerStats(g: GameState, b: Building): TowerStats {
  const def: TowerDef = g.cfg.defense.towers[b.kind]!;
  const s: TowerStats = {
    damage: def.damage, fireRate: def.fireRate, range: def.range, pierce: def.armorPierce ?? 0,
    slow: 0, slowS: 0, splash: def.splash ?? 0, burnDps: def.burnDps ?? 0, burnS: def.burnS ?? 0, stunS: def.stunS ?? 0,
    projectileSpeed: def.projectileSpeed,
  };
  const crew = g.members.filter((m) => m.post === b.id);
  if (crew.length) s.fireRate *= g.cfg.family.garrison.anyMemberFireRateMul;
  const bondMul = familyBondMul(g);
  for (const m of crew) {
    const bond = m.role ? g.cfg.family.roles[m.role]?.bond : undefined;
    if (!bond || bond.slot !== "tower") continue;
    if (bond.damageMul) s.damage *= 1 + (bond.damageMul - 1) * bondMul;
    if (bond.rangeMul) s.range *= 1 + (bond.rangeMul - 1) * bondMul;
    if (bond.armorPierce) s.pierce = Math.max(s.pierce, Math.min(1, bond.armorPierce * bondMul));
    if (bond.slow) { s.slow = Math.max(s.slow, Math.min(0.8, bond.slow * bondMul)); s.slowS = bond.slowS ?? 1; }
  }
  return s;
}

function familyBondMul(g: GameState): number {
  let mul = 1;
  for (const b of g.buildings.values()) mul *= g.cfg.economy.buildings[b.kind]?.effect?.familyBondMul ?? 1;
  return mul;
}

function tickTowers(g: GameState, dt: number): void {
  const T = g.cfg.tileSize;
  for (const b of g.buildings.values()) {
    if (b.category !== "tower") continue;
    b.cooldown -= dt;
    if (b.cooldown > 0) continue;
    const s = towerStats(g, b);
    const cx = (b.i + b.w / 2) * T, cy = (b.j + b.d / 2) * T;
    // 目标：射程内离主屋最近（流场距离最小）的敌人
    let best: Enemy | null = null, bestD = INF;
    for (const e of g.enemies) {
      if (e.hp <= 0 || Math.hypot(e.x - cx, e.y - cy) > s.range) continue;
      const d = distAt(flow(g, "house"), Math.floor(e.x / T), Math.floor(e.y / T));
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) continue;
    b.cooldown = 1 / s.fireRate;
    const dist = Math.hypot(best.x - cx, best.y - cy);
    g.projectiles.push({
      towerId: b.id, targetId: best.id, x: best.x, y: best.y, eta: dist / s.projectileSpeed,
      damage: s.damage, pierce: s.pierce, splash: s.splash, burnDps: s.burnDps, burnS: s.burnS, slow: s.slow, slowS: s.slowS, stunS: s.stunS,
    });
    g.events.push({ type: "shot", tower: b.id, target: best.id, x: best.x, y: best.y });
  }
}

function tickProjectiles(g: GameState, dt: number): void {
  const keep: Projectile[] = [];
  for (const p of g.projectiles) {
    const tgt = g.enemies.find((e) => e.id === p.targetId && e.hp > 0);
    if (tgt) { p.x = tgt.x; p.y = tgt.y; }
    p.eta -= dt;
    if (p.eta > 0) { keep.push(p); continue; }
    const victims = p.splash > 0
      ? g.enemies.filter((e) => e.hp > 0 && Math.hypot(e.x - p.x, e.y - p.y) <= p.splash)
      : tgt ? [tgt] : [];
    for (const e of victims) {
      const main = e === tgt;
      damageEnemy(g, e, main ? p.damage : p.damage * 0.6, p.pierce);
      if (p.slow > 0) applySlow(g, e, 1 - p.slow, p.slowS);
      if (p.burnDps > 0) { e.burnDps = Math.max(e.burnDps, p.burnDps); e.burnUntil = g.t + p.burnS; }
      if (p.stunS > 0) e.stunUntil = Math.max(e.stunUntil, g.t + p.stunS);
    }
  }
  g.projectiles = keep;
  g.enemies = g.enemies.filter((e) => e.hp > 0);
}

function tickBurn(g: GameState, dt: number): void {
  for (const e of g.enemies) {
    if (e.burnUntil > g.t && e.hp > 0) {
      e.hp -= e.burnDps * dt;
      if (e.hp <= 0) {
        e.hp = 0.0001; // 让 damageEnemy 统一结算奖励
        damageEnemy(g, e, 1, 1);
      }
    }
  }
  g.enemies = g.enemies.filter((e) => e.hp > 0);
  for (const b of [...g.buildings.values()]) {
    if (b.burnUntil > g.t) damageBuilding(g, b, b.burnDps * dt);
  }
}

// ============================================================================ 夜晚：家族

function tickFamilyNight(g: GameState, dt: number): void {
  const house = g.buildings.get(g.houseId);
  if (!house) return;
  const T = g.cfg.tileSize;
  const bondMul = familyBondMul(g);
  const heal = (b: Building, amt: number) => { b.hp = Math.min(b.maxHp, b.hp + amt); };
  if (g.married) {
    // 阿莲熬汤：主屋回 70%，最破的那段墙/塔回 100%（原型数值）
    const w = g.cfg.family.wife.nightHealPerS;
    heal(house, w * 0.7 * dt);
    let worst: Building | null = null;
    for (const b of g.buildings.values()) {
      if ((b.category === "wall" || b.category === "tower") && b.hp < b.maxHp && (!worst || b.hp / b.maxHp < worst.hp / worst.maxHp)) worst = b;
    }
    if (worst) heal(worst, w * dt);
  }
  for (const m of g.members) {
    if (!m.role || m.post === null) continue;
    const bond = g.cfg.family.roles[m.role]?.bond;
    const post = g.buildings.get(m.post);
    if (!bond || !post) continue;
    if (bond.slot === "house" && post.id === g.houseId && bond.healPerS) heal(house, bond.healPerS * bondMul * dt);
    if (bond.slot === "wall" && post.category === "wall" && bond.repairPerS) {
      const cx = (post.i + 0.5) * T, cy = (post.j + 0.5) * T;
      for (const b of g.buildings.values()) {
        if ((b.category === "wall" || b.category === "tower") && distToRect(cx, cy, b, T) <= (bond.radius ?? 4)) heal(b, bond.repairPerS * bondMul * dt);
      }
    }
  }
}

/** 主角守在主屋附近补刀：打守卫半径内离主屋最近的敌人 */
function tickHero(g: GameState, dt: number): void {
  const house = g.buildings.get(g.houseId);
  if (!house) return;
  g.heroCd -= dt;
  if (g.heroCd > 0) return;
  const hero = g.cfg.family.hero;
  const T = g.cfg.tileSize;
  let best: Enemy | null = null, bestD = INF;
  for (const e of g.enemies) {
    const d = distToRect(e.x, e.y, house, T);
    if (e.hp > 0 && d <= hero.guardRadius && d < bestD) { bestD = d; best = e; }
  }
  if (!best) return;
  g.heroCd = hero.attackCd;
  damageEnemy(g, best, hero.damage, 0);
  g.enemies = g.enemies.filter((e) => e.hp > 0);
}

// ============================================================================ 黎明

function endNight(g: GameState, survived: boolean): void {
  const house = g.buildings.get(g.houseId)!;
  g.nightLog.push({
    night: g.day, survived, houseHpPct: Math.max(0, house.hp / house.maxHp),
    spawned: g.cur.spawned, fled: g.cur.fled, buildingsLost: g.cur.lost, durationS: g.t - g.nightStartT,
  });
  g.enemies = [];
  g.projectiles = [];
  g.spawnQueue = [];
  if (!survived) {
    g.phase = "defeat";
    g.events.push({ type: "defeat", night: g.day });
    return;
  }
  const night = nightDef(g.cfg, g.day);
  gain(g, night.reward);
  // 口粮
  const mouths = 1 + g.members.length;
  g.res.food -= mouths * g.cfg.economy.upkeep.foodPerMemberPerDawn;
  const starved = g.res.food < 0;
  if (starved) {
    g.res.food = 0;
    house.hp = Math.max(1, house.hp - house.maxHp * g.cfg.economy.upkeep.starveHpPenalty);
  }
  // 长大与添丁
  for (const m of g.members) {
    if (m.kind === "child" && !m.role && g.day + 1 - m.bornDay >= g.cfg.family.growth.daysToYouth) {
      m.role = roleForWork(g.cfg, m.work);
      g.events.push({ type: "grownUp", member: m.id, name: m.name, role: m.role });
    }
  }
  if (g.married) {
    const cap = [...g.buildings.values()].reduce((s, b) => s + (g.cfg.economy.buildings[b.kind]?.capacity ?? 0), 0);
    const kids = g.members.filter((m) => m.kind === "child").length;
    for (let k = 0; k < g.cfg.family.birth.perDawn && kids + k < cap; k++) {
      const name = g.cfg.family.names[(kids + k) % g.cfg.family.names.length]!;
      const m: Member = { id: g.nextId++, name, kind: "child", bornDay: g.day + 1, role: null, work: "farm_rice", post: null };
      g.members.push(m);
      g.events.push({ type: "birth", member: m.id, name });
    }
  }
  // 白天免费修补一半缺损
  for (const b of g.buildings.values()) b.hp += (b.maxHp - b.hp) * 0.5;
  for (const b of g.buildings.values()) { b.burnUntil = 0; b.burnDps = 0; }
  g.events.push({ type: "dawn", night: g.day, reward: night.reward, starved });
  if (g.day === g.cfg.waves.nights.length) {
    g.phase = "victory";
    g.events.push({ type: "victory" });
    return;
  }
  g.day++;
  g.phase = "day";
  g.dayLeft = g.cfg.economy.dayLengthS;
  g.events.push({ type: "dayStart", day: g.day });
}

/** 通关后继续无尽模式 */
export function continueEndless(g: GameState): CmdResult {
  if (g.phase !== "victory") return { ok: false, reason: "还没通关" };
  g.day++;
  g.phase = "day";
  g.dayLeft = g.cfg.economy.dayLengthS;
  return { ok: true };
}

export function roleForWork(cfg: GameConfig, work: string): string {
  for (const [role, def] of Object.entries(cfg.family.roles)) if (def.work === work) return role;
  return "farmer";
}

/** 清空本帧事件（渲染/音效层消费完调用） */
export function drainEvents(g: GameState): GameEvent[] {
  const ev = g.events;
  g.events = [];
  return ev;
}

// ============================================================================ 查询（AI / UI 用）

/** 当前布局下从第 k 个出怪口走到主屋的格子路径（含起点，不含主屋格） */
export function pathFromSpawn(g: GameState, k = 0): Tile[] {
  const cost = tileCost(g);
  const house = g.buildings.get(g.houseId);
  if (!house) return [];
  const ff = buildFlowField(g.grid, footprintTiles(house), cost);
  const sp = g.cfg.map.spawns[k % g.cfg.map.spawns.length]!;
  const out: Tile[] = [{ i: sp.i, j: sp.j }];
  let cur: Tile | null = { i: sp.i, j: sp.j };
  for (let n = 0; n < g.grid.cols * g.grid.rows && cur; n++) {
    cur = nextStep(ff, g.grid, cur.i, cur.j, cost);
    if (!cur || g.grid.occupant(cur.i, cur.j) === g.houseId) break;
    out.push(cur);
  }
  return out;
}
