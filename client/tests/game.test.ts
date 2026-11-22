import { describe, expect, it } from "vitest";
import { defaultConfig, withOverrides, type GameConfig } from "../src/game/config";
import { buildFlowField, Grid, INF, nextStep } from "../src/game/flowField";
import {
  build, buildCost, createGame, drainEvents, garrison, nightDef, pathFromSpawn, runUntilPhaseChange, startNight,
  step, towerStats, upgradeHouse, assignWork, sellToPeddler, adReward, adOffers, productionMul, type GameState,
} from "../src/game/sim";
import { autoPlay } from "../src/game/bot";

const rich = (g: GameState) => { g.res = { coin: 99999, wood: 99999, food: 9999, hide: 999 }; };

/** 单测固定用的旧版谷地地图（与正式地图解耦，正式地图怎么改都不影响这些用例） */
const TEST_MAP = {
  terrain: [
    "ggfffgggggggw", "ggfffggggggww", "gggggggggggwg", "ggggggddggwwg", "ggggggdgggwgg", "gggggddggwwgg", "rggggdgggwggr",
    "rrgggdggwwggr", "rrggddggwgggr", "rrggdgggwggrr", "rrrgdggwwggrr", "rrrgdgggwgrrr", "rrrrdggwwgrrr", "rrrrddggwrrrr",
  ],
  house: { i: 5, j: 1 },
  spawns: [{ i: 4, j: 13 }, { i: 5, j: 13 }, { i: 6, j: 13 }],
};
const testConfig = () => withOverrides(defaultConfig(), (c) => { c.map = JSON.parse(JSON.stringify(TEST_MAP)); });


describe("流场寻路", () => {
  const cost = (grid: Grid, blocked: Set<string>, blockCost = 20) => (i: number, j: number) =>
    grid.terrainAt(i, j) === "r" ? INF : blocked.has(`${i},${j}`) ? blockCost : 1;

  it("空地上一路走到目标", () => {
    const grid = Grid.fromStrings(["ggggg", "ggggg", "ggggg"]);
    const c = cost(grid, new Set());
    const ff = buildFlowField(grid, [{ i: 0, j: 1 }], c);
    let cur: { i: number; j: number } | null = { i: 4, j: 1 };
    const seen: string[] = [];
    while (cur) { seen.push(`${cur.i},${cur.j}`); cur = nextStep(ff, grid, cur.i, cur.j, c); }
    expect(seen[seen.length - 1]).toBe("0,1");
    expect(seen.length).toBe(5);
  });

  it("墙挡路但能绕：绕过去而不是砍墙", () => {
    const grid = Grid.fromStrings(["ggggg", "ggggg", "ggggg", "ggggg"]);
    const wall = new Set(["2,0", "2,1", "2,2"]); // 留下 (2,3) 缺口
    const c = cost(grid, wall);
    const ff = buildFlowField(grid, [{ i: 0, j: 0 }], c);
    let cur: { i: number; j: number } | null = { i: 4, j: 0 };
    const path: string[] = [];
    while (cur) { path.push(`${cur.i},${cur.j}`); cur = nextStep(ff, grid, cur.i, cur.j, c); }
    expect(path.some((p) => wall.has(p))).toBe(false);
    expect(path).toContain("2,3");
  });

  it("完全堵死：从最便宜（最薄弱）的那段砍过去", () => {
    const grid = Grid.fromStrings(["ggggg", "ggggg", "ggggg"]);
    const strong = new Set(["2,0", "2,2"]), weak = new Set(["2,1"]);
    const c = (i: number, j: number) => strong.has(`${i},${j}`) ? 80 : weak.has(`${i},${j}`) ? 15 : 1;
    const ff = buildFlowField(grid, [{ i: 0, j: 1 }], c);
    let cur: { i: number; j: number } | null = { i: 4, j: 0 };
    const path: string[] = [];
    while (cur) { path.push(`${cur.i},${cur.j}`); cur = nextStep(ff, grid, cur.i, cur.j, c); }
    expect(path).toContain("2,1");
    expect(path).not.toContain("2,0");
  });

  it("山石不可通过，斜走不切墙角", () => {
    const grid = Grid.fromStrings(["grg", "rgg", "ggg"]);
    const c = cost(grid, new Set());
    const ff = buildFlowField(grid, [{ i: 2, j: 2 }], c);
    expect(ff.dist[grid.idx(0, 0)]).toBe(INF); // 被山石围住
    expect(nextStep(ff, grid, 1, 1, c)).toEqual({ i: 2, j: 2 });
  });
});

describe("建造规则", () => {
  it("地形、占用、山口、前置条件、价格", () => {
    const g = createGame(testConfig(), 1);
    rich(g);
    expect(build(g, "tower_bamboo", 0, 6).ok).toBe(false); // 山石
    expect(build(g, "fish_weir", 2, 3).ok).toBe(false);    // 鱼梁必须在水上
    expect(build(g, "fish_weir", 10, 3).ok).toBe(true);
    expect(build(g, "tower_bamboo", 5, 1).ok).toBe(false); // 主屋占着
    expect(build(g, "tower_bamboo", 5, 13).ok).toBe(false); // 山口
    expect(build(g, "tower_oil_fire", 3, 6).ok).toBe(false); // 需要成家
    expect(upgradeHouse(g).ok).toBe(true);
    expect(build(g, "tower_oil_fire", 3, 6).ok).toBe(true);
  });

  it("塔越多越贵（+8%/座），升级不受影响", () => {
    const g = createGame(testConfig(), 1);
    rich(g);
    expect(buildCost(g, "tower_bamboo")!.coin).toBe(60);
    build(g, "tower_bamboo", 3, 6);
    build(g, "tower_bamboo", 3, 7);
    expect(buildCost(g, "tower_bamboo")!.coin).toBe(Math.round(60 * 1.16));
    const before = g.res.coin;
    build(g, "farm_rice", 1, 0);
    expect(before - g.res.coin).toBe(40); // 非塔建筑不涨价
  });
});

describe("娶妻与家族", () => {
  it("修青瓦正房 = 娶妻：主屋升级、阿莲入住、产量 +40%", () => {
    const g = createGame(testConfig(), 1);
    rich(g);
    expect(upgradeHouse(g).ok).toBe(true);
    expect(g.married).toBe(true);
    expect(g.houseLevel).toBe(2);
    expect(g.members.find((m) => m.kind === "wife")?.name).toBe("阿莲");
    expect(g.buildings.get(g.houseId)!.maxHp).toBe(560);
  });

  it("有厢房就添丁；两个黎明后按白天分工长成对应身份", () => {
    const cfg = withOverrides(testConfig(), (c) => { c.waves.nights.forEach((n) => { n.groups = [{ type: "wolf", count: 1, interval: 1 }]; }); });
    const g = createGame(cfg, 3);
    rich(g);
    upgradeHouse(g);
    expect(build(g, "wing_room", 1, 3).ok).toBe(true);
    build(g, "tower_bamboo", 6, 6);
    startNight(g); runUntilPhaseChange(g);                    // 第 1 夜 → 黎明添丁
    const kid = g.members.find((m) => m.kind === "child")!;
    expect(kid).toBeTruthy();
    expect(assignWork(g, kid.id, "hunt_lodge").ok).toBe(true);
    startNight(g); runUntilPhaseChange(g);                    // 第 2 夜
    expect(kid.role).toBeNull();
    startNight(g); runUntilPhaseChange(g);                    // 第 3 夜 → 长成
    expect(kid.role).toBe("hunter");
    const events = drainEvents(g);
    expect(events.some((e) => e.type === "grownUp")).toBe(true);
  });
});

describe("驻守羁绊", () => {
  function youth(g: GameState, role: string) {
    const m = { id: g.nextId++, name: "测试", kind: "child" as const, bornDay: 0, role, work: "farm_rice", post: null as number | null };
    g.members.push(m);
    return m;
  }

  it("猎户驻塔 = 神射手：破甲 0.6、射程 ×1.15、伤害 ×1.15、攻速 ×1.2", () => {
    const g = createGame(testConfig(), 1);
    rich(g);
    const t = build(g, "tower_bamboo", 6, 6);
    if (!t.ok) throw new Error("build failed");
    const base = towerStats(g, g.buildings.get(t.id!)!);
    const m = youth(g, "hunter");
    expect(garrison(g, m.id, t.id!).ok).toBe(true);
    const s = towerStats(g, g.buildings.get(t.id!)!);
    expect(s.pierce).toBeCloseTo(0.6);
    expect(s.range).toBeCloseTo(base.range * 1.15);
    expect(s.damage).toBeCloseTo(base.damage * 1.15);
    expect(s.fireRate).toBeCloseTo(base.fireRate * 1.2);
  });

  it("渔郎驻塔 = 撒网减速；塔位满了不能再驻", () => {
    const g = createGame(testConfig(), 1);
    rich(g);
    const t = build(g, "tower_bamboo", 6, 6);
    if (!t.ok) throw new Error("build failed");
    const a = youth(g, "fisher"), b = youth(g, "hunter");
    expect(garrison(g, a.id, t.id!).ok).toBe(true);
    expect(towerStats(g, g.buildings.get(t.id!)!).slow).toBeCloseTo(0.35);
    expect(garrison(g, b.id, t.id!).ok).toBe(false);
  });

  it("没长大的孩子不能驻守", () => {
    const g = createGame(testConfig(), 1);
    rich(g);
    const t = build(g, "tower_bamboo", 6, 6);
    const kid = { id: g.nextId++, name: "小", kind: "child" as const, bornDay: 1, role: null, work: "farm_rice", post: null };
    g.members.push(kid);
    expect(garrison(g, kid.id, (t as { id: number }).id).ok).toBe(false);
  });
});

describe("夜战", () => {
  const onlyNight = (groups: GameConfig["waves"]["nights"][number]["groups"]) =>
    withOverrides(testConfig(), (c) => { c.waves.nights[0]!.groups = groups; });

  it("纵火贼直奔生产建筑放火，而不是主屋", () => {
    // 关掉当家的（农田就在主屋旁，会被他先砍倒），只看纵火贼选目标
    const g = createGame(withOverrides(onlyNight([{ type: "arsonist", count: 1, interval: 1 }]), (c) => { c.family.hero.damage = 0; }), 5);
    rich(g);
    const farm = build(g, "farm_rice", 2, 0);
    if (!farm.ok) throw new Error("farm");
    startNight(g);
    let hitFarm = false, hitHouse = false;
    for (let k = 0; k < 30 * 60 && g.phase === "night"; k++) {
      step(g, 1 / 30);
      for (const e of drainEvents(g)) if (e.type === "buildingHit") { if (e.id === farm.id) hitFarm = true; if (e.id === g.houseId) hitHouse = true; }
      if (hitFarm) break;
    }
    expect(hitFarm).toBe(true);
    expect(hitHouse).toBe(false);
  });

  it("第一夜：一座塔 + 当家的能守住", () => {
    const g = createGame(testConfig(), 11);
    build(g, "tower_bamboo", 6, 4);
    startNight(g);
    runUntilPhaseChange(g);
    expect(g.nightLog[0]!.survived).toBe(true);
    expect(g.phase).toBe("day");
    expect(g.day).toBe(2);
  });

  it("没有任何防御、主屋被打爆 → 失守", () => {
    const cfg = withOverrides(onlyNight([{ type: "boar", count: 12, interval: 0.3 }]), (c) => { c.family.hero.damage = 0; });
    const g = createGame(cfg, 2);
    startNight(g);
    runUntilPhaseChange(g);
    expect(g.phase).toBe("defeat");
  });

  it("出怪路线从山口通到主屋", () => {
    const g = createGame(testConfig(), 1);
    const p = pathFromSpawn(g, 1);
    expect(p[0]).toEqual({ i: 5, j: 13 });
    const last = p[p.length - 1]!;
    const house = g.buildings.get(g.houseId)!;
    expect(Math.abs(last.i - (house.i + 0.5)) + Math.abs(last.j - (house.j + house.d))).toBeLessThan(4);
  });
});

describe("确定性与无尽", () => {
  it("同种子同策略 → 完全相同的结果", async () => {
    const a = await autoPlay(testConfig(), 4, undefined, 42);
    const b = await autoPlay(testConfig(), 4, undefined, 42);
    expect(a.map((r) => [r.houseHpPct, r.coin, r.towers])).toEqual(b.map((r) => [r.houseHpPct, r.coin, r.towers]));
  });

  it("第 11 夜起按无尽倍率放大第 10 夜", () => {
    const cfg = defaultConfig();
    const n10 = nightDef(cfg, 10), n12 = nightDef(cfg, 12);
    expect(n12.hpMul).toBeCloseTo((cfg.waves.nights[9]!.hpMul ?? 1) * cfg.waves.endless.hpMulPerNight ** 2);
    expect(n12.groups[0]!.count).toBeGreaterThan(n10.groups[0]!.count);
  });
});

describe("货郎与激励视频", () => {
  it("货郎只在来访的白天收购；富商货郎让收购价翻倍（每天一次）", () => {
    const g = createGame(testConfig(), 1);
    g.res.food = 200;
    expect(sellToPeddler(g, "food", 100).ok).toBe(false); // 第一天没来
    g.peddler = true;
    expect(sellToPeddler(g, "food", 100).ok).toBe(true);
    expect(g.res.food).toBe(100);
    expect(g.res.coin).toBe(90 + 25);
    expect(adReward(g, "rich_peddler").ok).toBe(true);
    sellToPeddler(g, "food", 100);
    expect(g.res.coin).toBe(90 + 25 + 50);
    expect(adReward(g, "rich_peddler").ok).toBe(false);
  });

  it("风调雨顺：当天产量翻倍，第二天恢复", () => {
    const g = createGame(testConfig(), 1);
    const base = productionMul(g, "farm_rice");
    expect(adReward(g, "good_harvest").ok).toBe(true);
    expect(productionMul(g, "farm_rice")).toBeCloseTo(base * 2);
    build(g, "tower_bamboo", 6, 4);
    startNight(g);
    runUntilPhaseChange(g);
    expect(productionMul(g, "farm_rice")).toBeCloseTo(base);
  });

  it("双喜临门：有空位时黎明生双胞胎", () => {
    const cfg = withOverrides(testConfig(), (c) => { c.waves.nights[0]!.groups = [{ type: "wolf", count: 1, interval: 1 }]; });
    const g = createGame(cfg, 1);
    rich(g);
    upgradeHouse(g);
    build(g, "wing_room", 1, 3);
    expect(adReward(g, "double_happiness").ok).toBe(true);
    startNight(g);
    runUntilPhaseChange(g);
    expect(g.members.filter((m) => m.kind === "child").length).toBe(2);
  });

  it("绝境死守：只在夜里主屋 <15% 时可用，回到 60% 并定住附近敌人，每夜一次", () => {
    const g = createGame(testConfig(), 1);
    expect(adOffers(g).find((o) => o.kind === "last_stand")!.available).toBe(false);
    startNight(g);
    const house = g.buildings.get(g.houseId)!;
    house.hp = house.maxHp * 0.1;
    expect(adReward(g, "last_stand").ok).toBe(true);
    expect(house.hp).toBeCloseTo(house.maxHp * 0.6);
    house.hp = house.maxHp * 0.1;
    expect(adReward(g, "last_stand").ok).toBe(false);
  });
});

describe("陷阱", () => {
  it("敌人真正踩到陷阱格才触发，触发后掉血减速、次数减一", () => {
    const cfg = withOverrides(testConfig(), (c) => {
      c.waves.nights[0]!.groups = [{ type: "boar", count: 1, interval: 1 }];
      c.family.hero.guardRadius = 0; // 当家的不出手（damage=0 仍有保底 1 点伤害，所以直接把守卫半径设 0）
      c.map.spawns = [c.map.spawns[1]!]; // 只留一个山口，路线确定
    });
    const g = createGame(cfg, 4);
    rich(g);
    const path = pathFromSpawn(g, 0);
    const spot = path[5]!;
    const trap = build(g, "trap_bear", spot.i, spot.j);
    if (!trap.ok) throw new Error("trap");
    startNight(g);
    let firstHitTile: { i: number; j: number } | null = null;
    for (let k = 0; k < 30 * 60 && g.phase === "night" && !firstHitTile; k++) {
      const before = g.enemies[0]?.hp;
      step(g, 1 / 30);
      const e = g.enemies[0];
      if (e && before !== undefined && before - e.hp >= 50) firstHitTile = { i: Math.floor(e.x / 2), j: Math.floor(e.y / 2) };
    }
    expect(firstHitTile).toEqual({ i: spot.i, j: spot.j });
    const b = g.buildings.get(trap.id!);
    expect(b?.charges).toBe(2);
    expect(g.enemies[0]!.slowUntil).toBeGreaterThan(g.t);
  });
});
