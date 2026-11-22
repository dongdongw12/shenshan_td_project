/**
 * 竖屏可玩演示：T4 玩法核心（src/game）+ T3 渲染底座（src/render）+ 程序化墨线占位（inkDraw）。
 * 操作：底栏选建筑 → 点地块放置（绿色可放、红色不可）；拖动平移；点“入夜”开战。
 * URL：?auto=1 让平衡 AI 自己玩（看效果用），?seed=数字，?speed=2，?rich=1 开局多给资源（截图看后期建筑用，不影响平衡）
 */
import { BrowserPlatform } from "../platform/browser";
import { IsoProjection, type Vec2 } from "../render/iso";
import { IsoRenderer, type Camera, type SpriteImages } from "../render/renderer";
import { Scene } from "../render/scene";
import type { SpriteAtlasIndex } from "../render/spriteMeta";
import { paintGround, paintPaper, parseGroundMap } from "../render/groundPainter";
import { defaultConfig, parseFp, type Cost } from "../game/config";
import {
  build, buildCost, canBuildAt, createGame, drainEvents, kindInfo, repairAll, repairCost, startNight, step, upgrade, upgradeHouse,
  canAfford, sellToPeddler, adOffers, adReward, type AdKind, type Building, type GameState,
} from "../game/sim";
import { botDay, botFamily } from "../game/bot";
import { drawAnimFrame, facingFromScreenDelta, type AnimImages, type AnimIndex } from "../render/animSprites";
import {
  drawArrow, drawEnemy, drawFarmDecal, drawFence, drawFloatText, drawFlames, drawHouseLike, drawChimneySmoke, drawFireflies, drawHpBar, drawLampGlow, drawSmoke, drawTrapDecal, drawWeirDecal,
  isoBox, hipRoof, PAL, tone, type ToScreen,
} from "./inkDraw";

/** 敌人画得比真实比例大一些（手机上要一眼看清是狼是匪），只影响画面不影响判定 */
const ENEMY_SCALE = 1.7;
/** 烘培序列帧角色的放大倍数（同理：比真实比例大一些更易读） */
const CHAR_SCALE = 1.45;
const NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
const RES_ZH: Record<string, string> = { coin: "钱", wood: "木", food: "粮", hide: "兽材" };
const TOOLS: { kind: string; label: string }[] = [
  { kind: "tower_bamboo", label: "竹箭楼" }, { kind: "fence_wood", label: "篱笆" }, { kind: "trap_bear", label: "捕兽夹" },
  { kind: "farm_rice", label: "稻田" }, { kind: "fish_weir", label: "鱼梁" }, { kind: "hunt_lodge", label: "猎棚" },
  { kind: "wing_room", label: "厢房" }, { kind: "tower_oil_fire", label: "火油塔" },
];

interface Fx { kind: "smoke" | "text" | "arrow" | "flee"; enemy?: string; vx?: number; vy?: number; x: number; y: number; z?: number; t0: number; life: number; text?: string; color?: string; fromX?: number; fromY?: number; fire?: boolean }

async function boot(): Promise<void> {
  const qs = new URLSearchParams(location.search);
  const canvas = document.getElementById("stage") as HTMLCanvasElement;
  const platform = new BrowserPlatform(canvas);
  const atlas = await platform.loadJson<SpriteAtlasIndex>("/dev/sprites.json");
  const images = new Map<string, SpriteImages>();
  await Promise.all(Object.entries(atlas.sprites).map(async ([stem, m]) => {
    const [day, night, shadow] = await Promise.all([
      platform.loadImage(`/dev/${m.day_file}`), platform.loadImage(`/dev/${m.night_file}`),
      m.shadow_file ? platform.loadImage(`/dev/${m.shadow_file}`) : Promise.resolve(undefined),
    ]);
    images.set(stem, { day, night, shadow });
  }));

  // 角色序列帧（有就用，没有就退回程序化画法）
  const anims = new Map<string, AnimImages>();
  let animIndex: AnimIndex | null = null;
  try {
    animIndex = await platform.loadJson<AnimIndex>("/dev/chars/chars.json");
    await Promise.all(Object.entries(animIndex.chars).map(async ([id, m]) => {
      const L = (f: string) => platform.loadImage(`/dev/chars/${f}`);
      const [fd, fn, bd, bn] = await Promise.all([L(m.dirs.front.day), L(m.dirs.front.night), L(m.dirs.back.day), L(m.dirs.back.night)]);
      const entry: AnimImages = { front: { day: fd, night: fn }, back: { day: bd, night: bn }, actions: {} };
      for (const [act, a] of Object.entries(m.actions ?? {})) {
        if (act === "walk") continue;
        const [afd, afn, abd, abn] = await Promise.all([L(a.dirs.front.day), L(a.dirs.front.night), L(a.dirs.back.day), L(a.dirs.back.night)]);
        entry.actions![act] = { front: { day: afd, night: afn }, back: { day: abd, night: abn } };
      }
      anims.set(id, entry);
    }));
  } catch { animIndex = null; }

  const cfg = defaultConfig();
  const seed = Number(qs.get("seed") ?? 7);
  let g: GameState = createGame(cfg, seed);
  if (qs.get("rich") === "1") Object.assign(g.res, { coin: 9000, wood: 3000, food: 800, hide: 120 });
  const T = cfg.tileSize;
  const iso = new IsoProjection({ pxPerMeter: atlas.px_per_meter, tileSize: T, elevationDeg: 30 });
  const map = parseGroundMap(cfg.map.terrain);
  const off = (w: number, h: number) => platform.createOffscreen(w, h);
  const ground = { day: paintGround(off, map, atlas.px_per_meter, false, 11), night: paintGround(off, map, atlas.px_per_meter, true, 11) };
  const paper = paintPaper(off);
  const ctx = canvas.getContext("2d")!;
  const renderer = new IsoRenderer(ctx, iso, images);

  // 山石上点缀几棵古松（纯装饰，不进玩法）
  const decor: { i: number; j: number }[] = [];
  for (let j = 0; j < map.rows; j++) for (let i = 0; i < map.cols; i++) {
    if (map.terrain[j]![i] === "r" && (i * 7 + j * 13) % 5 === 0) decor.push({ i, j });
  }

  // 路的两头：村口山石上一对石灯，谷口山石上一座烽火盆
  const lanterns: { i: number; j: number }[] = [], braziers: { i: number; j: number }[] = [];
  {
    const road: { i: number; j: number }[] = [], rock: { i: number; j: number }[] = [];
    for (let j = 0; j < map.rows; j++) for (let i = 0; i < map.cols; i++) {
      const t = map.terrain[j]![i];
      if (t === "d") road.push({ i, j });
      else if (t === "r" && !decor.some((d) => d.i === i && d.j === j)) rock.push({ i, j });
    }
    const d2 = (a: { i: number; j: number }, b: { i: number; j: number }) => (a.i - b.i) ** 2 + (a.j - b.j) ** 2;
    let ends: [typeof road[0], typeof road[0]] | null = null, best = -1;
    for (const a of road) for (const b of road) if (d2(a, b) > best) { best = d2(a, b); ends = [a, b]; }
    if (ends) {
      // 靠主屋的一头是村口（一对石灯），靠出怪点的一头是谷口（烽火盆，入夜点燃示警）
      const h = cfg.map.house;
      const [village, gorge] = d2(ends[0], { i: h.i, j: h.j }) <= d2(ends[1], { i: h.i, j: h.j }) ? ends : [ends[1], ends[0]];
      const near = (e: { i: number; j: number }) => [...rock].sort((a, b) => d2(a, e) - d2(b, e));
      lanterns.push(...near(village).slice(0, 2));
      const b = near(gorge).find((t) => !lanterns.some((l) => l.i === t.i && l.j === t.j));
      if (b) braziers.push(b);
    }
  }

  // 谷地边缘（挨着可走格）的山石上几丛翠竹；离主屋最近的一块山石上一株红梅
  const bamboo: { i: number; j: number }[] = [];
  let plum: { i: number; j: number } | null = null;
  {
    const taken = (i: number, j: number) => [...decor, ...lanterns, ...braziers].some((t) => t.i === i && t.j === j);
    const edge: { i: number; j: number }[] = [];
    for (let j = 0; j < map.rows; j++) for (let i = 0; i < map.cols; i++) {
      if (map.terrain[j]![i] !== "r" || taken(i, j)) continue;
      const open = (x: number, y: number) => { const t = map.terrain[y]?.[x]; return t !== undefined && t !== "r"; };
      if (open(i - 1, j) || open(i + 1, j) || open(i, j - 1) || open(i, j + 1)) edge.push({ i, j });
    }
    const h = cfg.map.house;
    edge.sort((a, b) => (a.i - h.i) ** 2 + (a.j - h.j) ** 2 - ((b.i - h.i) ** 2 + (b.j - h.j) ** 2));
    plum = edge.shift() ?? null;
    bamboo.push(...edge.filter((_, n) => n % 3 === 1));
  }

  // ---------------------------------------------------------------- 相机
  const cam: Camera = { x: 0, y: 0, zoom: 1 };
  const fit = () => {
    const { w } = platform.screenSize();
    // 只框住谷地（非山石格），两侧山石让它出画
    const pts: Vec2[] = [];
    for (let j = 0; j < map.rows; j++) for (let i = 0; i < map.cols; i++) {
      if (map.terrain[j]![i] === "r") continue;
      pts.push(iso.worldToScreen({ x: i * T, y: j * T }), iso.worldToScreen({ x: (i + 1) * T, y: (j + 1) * T }),
        iso.worldToScreen({ x: (i + 1) * T, y: j * T }), iso.worldToScreen({ x: i * T, y: (j + 1) * T }));
    }
    const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y)) - 2 * iso.kz, maxY = Math.max(...pts.map((p) => p.y)) + 0.6 * iso.kz;
    // 可视区 = 顶栏下沿到底栏上沿（按实际布局量，底栏换行时也对）
    const frame = canvas.getBoundingClientRect();
    const topY = document.getElementById("top")!.getBoundingClientRect().bottom - frame.top + 4;
    const botY = document.getElementById("bottom")!.getBoundingClientRect().top - frame.top - 4;
    const usableH = Math.max(100, botY - topY);
    cam.zoom = Math.min((w * 1.15) / (maxX - minX), usableH / (maxY - minY));
    cam.x = w / 2 - ((minX + maxX) / 2) * cam.zoom;
    cam.y = topY + usableH / 2 - ((minY + maxY) / 2) * cam.zoom;
  };
  const resize = () => {
    const dpr = platform.pixelRatio();
    const { w, h } = platform.screenSize();
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    fit();
  };
  window.addEventListener("resize", resize);
  resize();
  const S: ToScreen = (x, y, z = 0) => { const p = iso.worldToScreen({ x, y, z }); return { x: cam.x + p.x * cam.zoom, y: cam.y + p.y * cam.zoom }; };

  // ---------------------------------------------------------------- 状态
  let tool: string | null = null;
  let hoverTile: { i: number; j: number } | null = null;
  let selected: number | null = null;
  let speed = Number(qs.get("speed") ?? 1);
  // 开发台截图用：控制台里 __demo.speed = 1 / __demo.g 查看状态（只在 dev server 里存在）
  if (import.meta.env?.DEV) {
    Object.defineProperty(globalThis, "__demo", { configurable: true, value: { get g() { return g; }, get villagers() { return villagers; }, get speed() { return speed; }, set speed(v: number) { speed = v; } } });
  }
  const auto = qs.get("auto") === "1";
  let nightA = 0;
  let clock = 0;
  const fx: Fx[] = [];
  const lastPos = new Map<number, Vec2>();
  const facing = new Map<number, number>();
  const animFacing = new Map<number, { dir: "front" | "back"; flip: boolean }>();
  /** 敌人最近一次被打中的时刻（受击闪白） */
  const hitAt = new Map<number, number>();

  // ---------------------------------------------------------------- 家人（纯表现层：白天走动干活，夜里当家的守门）
  interface Villager {
    key: string; kind: "hero" | "wife" | "child"; x: number; y: number; tx: number; ty: number; wait: number;
    face: { dir: "front" | "back"; flip: boolean }; attackT: number;
    /** 走到稻田边后干活（当家的刨地、妻儿插秧），面朝田的中心 */
    workAt: Vec2 | null;
  }
  const villagers = new Map<string, Villager>();
  const houseDoor = () => { const h = g.buildings.get(g.houseId)!; return { x: (h.i + h.w / 2) * T, y: h.j * T - 0.6 }; };
  const frontOf = (b: Building) => ({ x: (b.i + b.w / 2) * T + (vrand() - 0.5) * T * 0.6, y: b.j * T - 0.5 });
  let vseed = 99;
  const vrand = () => { vseed = (vseed * 1664525 + 1013904223) >>> 0; return vseed / 4294967296; };
  const syncVillagers = (dt: number) => {
    const want: { key: string; kind: Villager["kind"] }[] = [{ key: "hero", kind: "hero" }];
    if (g.married) want.push({ key: "wife", kind: "wife" });
    g.members.filter((m) => m.kind === "child").forEach((m) => want.push({ key: `c${m.id}`, kind: "child" }));
    for (const w of want) if (!villagers.has(w.key)) { const d = houseDoor(); villagers.set(w.key, { ...w, x: d.x, y: d.y, tx: d.x, ty: d.y, wait: vrand() * 2, face: { dir: "front", flip: false }, attackT: 0, workAt: null }); }
    for (const k of [...villagers.keys()]) if (!want.some((w) => w.key === k)) villagers.delete(k);
    const day = g.phase === "day";
    const work = [...g.buildings.values()].filter((b) => b.category === "production" || b.category === "tower");
    const fields = [...g.buildings.values()].filter((b) => b.kind === "farm_rice" || b.kind === "fish_weir");
    for (const v of villagers.values()) {
      v.attackT = Math.max(0, v.attackT - dt);
      if (!day) {
        v.workAt = null;
        const d = houseDoor();
        v.tx = d.x + (v.kind === "hero" ? 0 : 0.01); v.ty = d.y;
        if (v.kind === "hero") {
          // 守门：守卫半径内有敌人就挥锄（与模拟里当家的补刀对应）
          const h = g.buildings.get(g.houseId)!;
          const near = g.enemies.find((e) => Math.hypot(e.x - (h.i + h.w / 2) * T, e.y - (h.j + h.d / 2) * T) < cfg.family.hero.guardRadius + 2);
          if (near) { v.attackT = 0.3; v.face = facingFromScreenDelta((near.x - v.x) + (near.y - v.y), (near.x - v.x) - (near.y - v.y), v.face); }
        }
      } else {
        v.wait -= dt;
        if (v.wait <= 0 && Math.hypot(v.tx - v.x, v.ty - v.y) < 0.1) {
          const farms = fields.filter((b) => b.kind === "farm_rice");
          // 当家的一半时间下田、一半时间在各处转；阿莲多半在田里；孩子在门口玩，偶尔跟着下田
          const pool = v.kind === "wife" ? (fields.length ? fields : work)
            : v.kind === "hero" ? (farms.length && vrand() < 0.5 ? farms : work)
            : farms.length && vrand() < 0.35 ? farms : [];
          const b = pool.length ? pool[Math.floor(vrand() * pool.length)]! : null;
          // 闲逛点只落在谷地里能走的空格上（主屋门前就是山石，别走到石头上去）
          const wander = () => {
            for (let tries = 0; tries < 8; tries++) {
              const p = { x: houseDoor().x + (vrand() - 0.5) * 5, y: houseDoor().y + (vrand() - 0.5) * 4 };
              const ti = Math.floor(p.x / T), tj = Math.floor(p.y / T);
              if (freeTile(ti, tj)) return p;
            }
            return houseDoor();
          };
          const pick = b ? frontOf(b) : wander();
          v.workAt = b && b.kind === "farm_rice" ? { x: (b.i + b.w / 2) * T, y: (b.j + b.d / 2) * T } : null;
          v.tx = pick.x; v.ty = pick.y; v.wait = (v.workAt ? 4 : 2) + vrand() * 3;
        }
      }
      const dx = v.tx - v.x, dy = v.ty - v.y, dist = Math.hypot(dx, dy);
      const sp = (v.kind === "child" ? 1.5 : 1.2) * dt * speed;
      if (dist > 0.05) {
        const k = Math.min(1, sp / dist);
        v.x += dx * k; v.y += dy * k;
        v.face = facingFromScreenDelta(dx + dy, dx - dy, v.face);
      } else if (v.workAt) {
        const fx = v.workAt.x - v.x, fy = v.workAt.y - v.y;
        v.face = facingFromScreenDelta(fx + fy, fx - fy, v.face);
      }
    }
  };
  const addVillagers = () => {
    for (const v of villagers.values()) {
      const meta = animIndex?.chars[v.kind], img = anims.get(v.kind);
      if (!meta || !img) continue;
      const home = Math.hypot(v.tx - v.x, v.ty - v.y) < 0.1 && g.phase !== "day" && v.kind !== "hero";
      if (home) continue; // 夜里妻儿进屋
      const moving = Math.hypot(v.tx - v.x, v.ty - v.y) > 0.05;
      scene.addCustom({
        id: `v_${v.key}`, pos: { x: v.x, y: v.y, z: 0 }, radius: 0,
        draw: (c, p, ppm) => {
          c.globalAlpha = 0.3 * (1 - 0.4 * nightA); c.fillStyle = "#1f2740";
          c.beginPath(); c.ellipse(p.x, p.y, ppm * 0.35 * CHAR_SCALE, ppm * 0.14 * CHAR_SCALE, 0, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
          const working = !moving && v.workAt && g.phase === "day" && meta.actions?.work && img.actions?.work;
          const action = v.attackT > 0 ? "attack" : working ? "work" : "walk";
          // 各人干活节奏错开一点，免得全村齐刷刷同一帧
          const phase = v.key.length * 0.37 + (v.kind === "child" ? 0.5 : 0);
          drawAnimFrame(c, meta, img, p, ppm, CHAR_SCALE, v.face.dir, v.face.flip, action === "walk" && !moving ? 0 : clock + phase, nightA, action);
        },
      });
    }
  };
  let autoTimer = 0;

  // ---------------------------------------------------------------- UI
  const $ = (id: string) => document.getElementById(id)!;
  const toastEl = $("toast");
  let toastTimer = 0;
  const toast = (msg: string) => { toastEl.textContent = msg; toastEl.style.opacity = "1"; toastTimer = 2.6; };
  const costText = (c: Cost | null | undefined) => c ? Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${v}${RES_ZH[k]}`).join(" ") : "";

  // 底栏按钮只创建一次，之后只改文字/状态：频繁重建会让“按下-抬起”之间按钮被替换，点击丢失
  type Btn = { el: HTMLButtonElement; update: () => void };
  const buttons: Btn[] = [];
  const mkBtn = (onClick: () => void, update: (el: HTMLButtonElement) => void, cls = ""): void => {
    const el = document.createElement("button");
    el.type = "button";
    if (cls) el.className = cls;
    el.onclick = () => { onClick(); renderBottom(); };
    $("bottom").appendChild(el);
    buttons.push({ el, update: () => update(el) });
  };
  const setHtml = (el: HTMLElement, html: string) => { if (el.innerHTML !== html) el.innerHTML = html; };
  for (const t of TOOLS) {
    const info = kindInfo(cfg, t.kind)!;
    mkBtn(() => { tool = tool === t.kind ? null : t.kind; selected = null; renderPanel(); }, (el) => {
      el.classList.toggle("on", tool === t.kind);
      setHtml(el, `${t.label}<small>${costText(buildCost(g, t.kind))}</small>`);
      el.disabled = g.phase !== "day" || (info.requires === "married" && !g.married);
    });
  }
  mkBtn(() => { const r = upgradeHouse(g); if (!r.ok) toast(r.reason); }, (el) => {
    const next = g.houseLevel === 1 ? cfg.economy.house.lv2 : g.houseLevel === 2 ? cfg.economy.house.lv3 : null;
    setHtml(el, next ? `${g.houseLevel === 1 ? "修房娶妻" : "扩建大院"}<small>${costText(next.cost)}</small>` : "大院已成");
    el.disabled = g.phase !== "day" || !next || !canAfford(g, next.cost);
  });
  mkBtn(() => { repairAll(g); }, (el) => {
    const rc = repairCost(g);
    setHtml(el, `修补<small>${(rc.coin ?? 0) > 0 ? costText(rc) : "完好"}</small>`);
    el.disabled = g.phase !== "day" || (rc.coin ?? 0) === 0 || !canAfford(g, rc);
  });
  mkBtn(() => { const log = botFamily(g); toast(log[log.length - 1] ?? "家人已各就各位"); }, (el) => {
    setHtml(el, `安排家人<small>${g.members.length} 口</small>`);
  });
  // 货郎：来访的白天出现，一键卖掉结余（留两天口粮、100 木）
  mkBtn(() => {
    const keep = { food: (1 + g.members.length) * cfg.economy.upkeep.foodPerMemberPerDawn * 2 + 30, wood: 100 };
    const before = g.res.coin;
    for (const r of ["food", "wood"] as const) { const n = Math.floor(g.res[r] - keep[r]); if (n > 0) sellToPeddler(g, r, n); }
    toast(g.res.coin > before ? `卖给货郎，得 ${Math.floor(g.res.coin - before)} 钱` : "没有多余的粮木可卖");
  }, (el) => {
    el.style.display = g.phase === "day" && g.peddler ? "" : "none";
    setHtml(el, `货郎进山<small>卖余粮余木${g.ads.priceMul > 1 ? " ×2" : ""}</small>`);
  });
  // 激励视频（演示里直接模拟看完）
  for (const kind of ["good_harvest", "rich_peddler", "double_happiness", "last_stand"] as AdKind[]) {
    mkBtn(() => { const r = adReward(g, kind); toast(r.ok ? `▶ ${cfg.economy.ads[kind].name}（演示：模拟看完广告）` : r.reason); }, (el) => {
      const offer = adOffers(g).find((o) => o.kind === kind)!;
      el.style.display = offer.available ? "" : "none";
      setHtml(el, `▶ ${offer.name}<small>看广告</small>`);
    }, kind === "last_stand" ? "primary" : "");
  }
  mkBtn(() => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; }, (el) => setHtml(el, `${speed}× 速度`));
  mkBtn(() => { startNight(g); tool = null; }, (el) => {
    const day = g.phase === "day";
    setHtml(el, day ? `入夜 ▶<small>还有 ${Math.ceil(g.dayLeft)} 秒天黑</small>` : `守夜中<small>${g.enemies.length + g.spawnQueue.length} 敌</small>`);
    el.disabled = !day;
  }, "primary");
  const renderBottom = () => { for (const b of buttons) b.update(); };

  const renderPanel = () => {
    const p = $("panel");
    const b = selected !== null ? g.buildings.get(selected) : undefined;
    if (!b) { p.classList.remove("show"); return; }
    const name = cfg.defense.towers[b.kind]?.name ?? cfg.defense.walls[b.kind]?.name ?? cfg.economy.buildings[b.kind]?.name ?? (b.category === "house" ? cfg.economy.house[`lv${g.houseLevel}` as "lv1"].name : b.kind);
    const crew = g.members.filter((m) => m.post === b.id).map((m) => `${m.name}（${cfg.family.roles[m.role ?? ""]?.bond.name ?? ""}）`);
    const up = cfg.defense.towers[b.kind]?.upgrade ?? cfg.defense.walls[b.kind]?.upgrade;
    const upDef = up ? cfg.defense.towers[up] ?? cfg.defense.walls[up] : null;
    p.innerHTML = `<b>${name}</b>　${Math.round(b.hp)}/${b.maxHp}<br>${crew.length ? `驻守：${crew.join("、")}<br>` : ""}`;
    if (upDef) {
      const btn = document.createElement("button");
      btn.innerHTML = `升级为${upDef.name}　${costText(upDef.cost)}`;
      btn.disabled = g.phase !== "day";
      btn.onclick = () => { const r = upgrade(g, b.id); toast(r.ok ? `已升级为${upDef.name}` : r.reason); renderPanel(); renderBottom(); };
      p.appendChild(btn);
    }
    p.classList.add("show");
  };

  const renderTop = () => {
    $("title").textContent = g.phase === "night" ? `第${NUM[g.day] ?? g.day}夜 · ${cfg.waves.nights[g.day - 1]?.title.split("·")[1]?.trim() ?? "无尽"}`
      : g.phase === "day" ? `第${NUM[g.day] ?? g.day}天 · 白昼` : g.phase === "victory" ? "大获全胜" : "寨破";
    $("res").innerHTML = (["coin", "wood", "food", "hide"] as const).map((k) => `<span>${RES_ZH[k]} ${Math.floor(g.res[k])}</span>`).join("");
    const h = g.buildings.get(g.houseId);
    ($("hp").firstElementChild as HTMLElement).style.width = `${h ? (100 * h.hp) / h.maxHp : 0}%`;
  };

  const banner = (text: string) => { $("bannerText").textContent = text; $("banner").classList.add("show"); };
  $("bannerBtn").onclick = () => { g = createGame(cfg, seed + Math.floor(Math.random() * 1000)); $("banner").classList.remove("show"); renderBottom(); };

  // ---------------------------------------------------------------- 输入
  let down: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  const toWorldTile = (cx: number, cy: number) => {
    const r = canvas.getBoundingClientRect();
    return iso.screenToTile({ x: (cx - r.left - cam.x) / cam.zoom, y: (cy - r.top - cam.y) / cam.zoom });
  };
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    hoverTile = toWorldTile(e.clientX, e.clientY);
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) > 6) down.moved = true;
    if (down.moved) { cam.x = down.cx + dx; cam.y = down.cy + dy; }
  });
  canvas.addEventListener("pointerup", (e) => {
    const d = down; down = null;
    if (!d || d.moved) return;
    const t = toWorldTile(e.clientX, e.clientY);
    if (tool) {
      const r = build(g, tool, t.i, t.j);
      if (!r.ok) toast(r.reason);
      renderBottom();
    } else {
      const id = g.grid.occupant(t.i, t.j);
      selected = id || null;
      renderPanel();
    }
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const k = Math.exp(-e.deltaY * 0.0015), mx = e.clientX - r.left, my = e.clientY - r.top;
    cam.x = mx - (mx - cam.x) * k; cam.y = my - (my - cam.y) * k; cam.zoom *= k;
  }, { passive: false });

  // ---------------------------------------------------------------- 场景同步
  const scene = new Scene(map.cols, map.rows, atlas);
  /** 玩法里的建筑 id → 资产 id（厢房在玩法里叫 wing_room，资产叫 house_wing_room） */
  const spriteKind = (kind: string) => (kind === "wing_room" ? "house_wing_room" : kind);
  const isWallAt = (i: number, j: number) => {
    const id = g.grid.occupant(i, j);
    return !!id && g.buildings.get(id)?.category === "wall";
  };
  const spriteFor = (b: Building): string | null => {
    const has = (s: string) => (atlas.sprites[s] ? s : null);
    if (b.category === "house") return has(["house_lv1_thatch", "house_lv2_tile", "house_lv3_courtyard"][g.houseLevel - 1]!);
    if (b.kind === "tower_crossbow") return has("tower_crossbow") ?? has("tower_bamboo");
    if (["tower_bamboo", "house_wing_room", "hunt_lodge", "granary", "tower_oil_fire", "tower_rolling_log", "ancestral_hall", "fish_weir"].includes(spriteKind(b.kind))) return has(spriteKind(b.kind));
    if (b.category === "wall") {
      // 只和 ±Y 方向的墙相连 → 用 90° 那张，墙段就能接成一条线
      const alongY = (isWallAt(b.i, b.j - 1) || isWallAt(b.i, b.j + 1)) && !(isWallAt(b.i - 1, b.j) || isWallAt(b.i + 1, b.j));
      const base = b.kind === "wall_brick" ? "wall_brick" : "fence_wood";
      return has(`${base}_a${alongY ? 90 : 0}`);
    }
    if (b.kind === "farm_rice") {
      const ripe = b.cycleT / (cfg.economy.buildings.farm_rice!.cycleS ?? 1) > 0.65;
      return has(ripe ? "farm_rice_ripe" : "farm_rice_young");
    }
    if (b.category === "trap") return has("trap_bear");
    return null;
  };
  /** 纯装饰：路口两侧山石上的石灯（山石格不可建，不会和玩家的建筑打架）；货郎来的白天，门前停一辆货郎车。只占空地，不进玩法 */
  const freeTile = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < map.cols && j < map.rows && map.terrain[j]![i] !== "r" && map.terrain[j]![i] !== "w" && !g.grid.occupant(i, j);
  const addHouseProps = () => {
    const h = g.buildings.get(g.houseId);
    if (!h) return;
    const front = h.j - 1; // 正面朝画面左下 = −j 方向
    if (atlas.sprites.prop_stone_lantern) for (const l of lanterns) scene.addSprite("prop_stone_lantern", l.i, l.j, `lantern@${l.i},${l.j}`);
    if (atlas.sprites.prop_beacon_brazier) for (const b of braziers) scene.addSprite("prop_beacon_brazier", b.i, b.j, `beacon@${b.i},${b.j}`);
    if (atlas.sprites.prop_bamboo_clump) for (const b of bamboo) scene.addSprite("prop_bamboo_clump", b.i, b.j, `bamboo@${b.i},${b.j}`);
    if (atlas.sprites.prop_plum_tree && plum) scene.addSprite("prop_plum_tree", plum.i, plum.j, "plum");
    if (atlas.sprites.prop_peddler_cart && g.phase === "day" && g.peddler) {
      const spot = [[h.i + h.w, front], [h.i - 1, front], [h.i + h.w, h.j], [h.i, front - 1]].find(([i, j]) => freeTile(i!, j!));
      if (spot) scene.addSprite("prop_peddler_cart", spot[0]!, spot[1]!, "peddler_cart");
    }
  };
  const syncScene = () => {
    scene.objects.length = 0;
    if (atlas.sprites.prop_pine_tree) for (const d of decor) scene.addSprite("prop_pine_tree", d.i, d.j, `pine@${d.i},${d.j}`);
    addHouseProps();
    for (const b of g.buildings.values()) {
      const stem = spriteFor(b);
      if (!stem && (b.category === "trap" || b.kind === "farm_rice" || b.kind === "fish_weir")) continue; // 没有精灵的贴地物件画在贴地图层
      if (stem) { scene.addSprite(stem, b.i, b.j, `b${b.id}`); continue; }
      const cx = (b.i + b.w / 2) * T, cy = (b.j + b.d / 2) * T;
      scene.addCustom({ id: `b${b.id}`, pos: { x: cx, y: cy, z: 0 }, radius: (Math.min(b.w, b.d) * T) / 2 - 0.01, draw: (c) => drawBuilding(c, b) });
    }
    addVillagers();
    for (const e of g.enemies) {
      const prev = lastPos.get(e.id);
      if (prev) {
        const dxs = (e.x - prev.x) + (e.y - prev.y); // 屏幕 x ∝ x + y
        const dys = (e.x - prev.x) - (e.y - prev.y); // 屏幕 y ∝ x − y
        if (Math.abs(dxs) > 1e-3) facing.set(e.id, dxs > 0 ? 1 : -1);
        animFacing.set(e.id, facingFromScreenDelta(dxs, dys, animFacing.get(e.id) ?? { dir: "front", flip: false }));
      }
      lastPos.set(e.id, { x: e.x, y: e.y });
      const face = facing.get(e.id) ?? -1;
      const anim = animIndex?.chars[e.type];
      const animImg = anims.get(e.type);
      scene.addCustom({
        id: `e${e.id}`, pos: { x: e.x, y: e.y, z: 0 }, radius: 0,
        draw: anim && animImg
          ? (c, p, ppm) => {
            let f = animFacing.get(e.id) ?? { dir: "front" as const, flip: false };
            // 正在砍建筑：播攻击动作并转向目标
            const tb = e.attacking ? g.buildings.get(e.attacking) : undefined;
            if (tb) {
              const tx = (tb.i + tb.w / 2) * T - e.x, ty = (tb.j + tb.d / 2) * T - e.y;
              f = facingFromScreenDelta(tx + ty, tx - ty, f);
            }
            // 脚下墨色小地影
            c.globalAlpha = 0.3 * (1 - 0.4 * nightA); c.fillStyle = "#1f2740";
            c.beginPath(); c.ellipse(p.x, p.y, ppm * 0.45 * CHAR_SCALE, ppm * 0.18 * CHAR_SCALE, 0, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
            const animT = tb ? clock : clock * e.def.speed / 1.8, act = tb ? "attack" : "walk";
            drawAnimFrame(c, anim, animImg, p, ppm, CHAR_SCALE, f.dir, f.flip, animT, nightA, act);
            // 受击：叠加混合再画一遍同一帧，闪一下白（0.12 秒内淡掉）
            const since = clock - (hitAt.get(e.id) ?? -9);
            if (since < 0.12) {
              c.save(); c.globalCompositeOperation = "lighter"; c.globalAlpha = 0.55 * (1 - since / 0.12);
              drawAnimFrame(c, anim, animImg, p, ppm, CHAR_SCALE, f.dir, f.flip, animT, 0, act);
              c.restore();
            }
            if (e.hp < e.maxHp) {
              const w = ppm * 0.7 * CHAR_SCALE, h = Math.max(2, ppm * 0.07), y = p.y - anim.anchor_px[1] * (ppm / anim.px_per_meter) * CHAR_SCALE - 4;
              c.fillStyle = "rgba(28,21,16,0.75)"; c.fillRect(p.x - w / 2 - 1, y - 1, w + 2, h + 2);
              c.fillStyle = "#b8352a"; c.fillRect(p.x - w / 2, y, w * Math.max(0, e.hp / e.maxHp), h);
            }
          }
          : (c, p, ppm) => drawEnemy(c, e.type, p, ppm * 0.1 * ENEMY_SCALE, nightA, face, (clock * e.def.speed * 0.9) % 1, e.hp / e.maxHp, clock),
      });
    }
  };

  const drawBuilding = (c: CanvasRenderingContext2D, b: Building) => {
    const lw = Math.max(0.8, iso.cfg.pxPerMeter * cam.zoom * 0.035);
    const x0 = b.i * T, y0 = b.j * T, x1 = (b.i + b.w) * T, y1 = (b.j + b.d) * T;
    const n = nightA;
    if (b.category === "wall") { drawFence(c, S, b.i, b.j, T, n, lw, b.kind === "wall_brick"); return; }
    if (b.category === "house") {
      if (g.houseLevel === 1) drawHouseLike(c, S, x0, y0, x1, y1, 2.0, 1.6, { wall: PAL.wood, wallShade: PAL.woodShade, roof: PAL.thatch, roofShade: PAL.thatchShade }, n, lw);
      else drawHouseLike(c, S, x0, y0, x1, y1, 2.6, 1.8, { wall: "#8b9592", wallShade: PAL.stoneShade, roof: PAL.tile, roofShade: PAL.tileShade }, n, lw, (z) => {
        isoBox(c, S, x0 + 0.6, y0 + 0.05, x1 - 0.6, y0 + 0.35, 0, z * 0.85, { top: tone(PAL.cinnabar, n), left: tone(PAL.cinnabar, n), right: tone("#8e2a20", n) }, lw);
      });
      return;
    }
    if (b.kind === "tower_oil_fire" || b.kind === "tower_rolling_log") {
      const big = b.kind === "tower_rolling_log";
      isoBox(c, S, x0 + 0.35, y0 + 0.35, x1 - 0.35, y1 - 0.35, 0, big ? 3.6 : 3.2, { top: tone(PAL.wood, n), left: tone(PAL.wood, n), right: tone(PAL.woodShade, n) }, lw);
      isoBox(c, S, x0 + 0.1, y0 + 0.1, x1 - 0.1, y1 - 0.1, big ? 3.6 : 3.2, big ? 4.6 : 4.0, { top: tone(PAL.stone, n), left: tone(PAL.stone, n), right: tone(PAL.stoneShade, n) }, lw);
      hipRoof(c, S, x0 + 0.1, y0 + 0.1, x1 - 0.1, y1 - 0.1, big ? 4.6 : 4.0, big ? 6 : 5.1, 0.2, tone(PAL.cinnabar, n), tone("#8e2a20", n), lw);
      if (!big) { const f = S((x0 + x1) / 2, y0 + 0.1, 4.4); c.fillStyle = n > 0.3 ? "#ffb347" : "#f08a2c"; c.beginPath(); c.ellipse(f.x, f.y, lw * 2.5, lw * 4, 0, 0, Math.PI * 2); c.fill(); }
      return;
    }
    const pal = b.kind === "hunt_lodge" ? { wall: PAL.wood, wallShade: PAL.woodShade, roof: PAL.thatch, roofShade: PAL.thatchShade }
      : b.kind === "granary" ? { wall: "#c88f5f", wallShade: PAL.wood, roof: PAL.thatch, roofShade: PAL.thatchShade }
      : b.kind === "ancestral_hall" ? { wall: PAL.cinnabar, wallShade: "#8e2a20", roof: PAL.tile, roofShade: PAL.tileShade }
      : { wall: PAL.lime, wallShade: PAL.limeShade, roof: PAL.tile, roofShade: PAL.tileShade };
    drawHouseLike(c, S, x0, y0, x1, y1, b.kind === "granary" ? 2.4 : 2.0, b.kind === "ancestral_hall" ? 2.2 : 1.5, pal, n, lw);
  };

  const drawDecals = (c: CanvasRenderingContext2D) => {
    const lw = Math.max(0.8, iso.cfg.pxPerMeter * cam.zoom * 0.035);
    for (const b of g.buildings.values()) {
      if (spriteFor(b)) continue;
      if (b.kind === "farm_rice") drawFarmDecal(c, S, b.i, b.j, b.w, b.d, T, nightA, lw, b.cycleT / (cfg.economy.buildings.farm_rice!.cycleS ?? 1));
      else if (b.kind === "fish_weir") drawWeirDecal(c, S, b.i, b.j, b.w, b.d, T, nightA, lw, clock);
      else if (b.category === "trap") drawTrapDecal(c, S, b.i, b.j, T, nightA, lw, b.charges);
    }
    // 选址预览
    if (tool && hoverTile && g.phase === "day") {
      const fp = parseFp(kindInfo(cfg, tool)!.footprint);
      const ok = canBuildAt(g, tool, hoverTile.i, hoverTile.j).ok && canAfford(g, buildCost(g, tool) ?? undefined);
      const { i, j } = hoverTile;
      c.globalAlpha = 0.45;
      c.fillStyle = ok ? "#7fb98a" : "#d9694a";
      c.beginPath();
      [S(i * T, j * T), S((i + fp.w) * T, j * T), S((i + fp.w) * T, (j + fp.d) * T), S(i * T, (j + fp.d) * T)].forEach((p, k) => (k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.closePath(); c.fill();
      c.globalAlpha = 1;
      // 塔显示射程
      const td = cfg.defense.towers[tool];
      if (td) {
        const ctr = S((i + fp.w / 2) * T, (j + fp.d / 2) * T);
        c.strokeStyle = "rgba(28,21,16,0.55)"; c.setLineDash([4, 4]); c.lineWidth = 1.2;
        c.beginPath(); c.ellipse(ctr.x, ctr.y, td.range * iso.kx * cam.zoom * Math.SQRT2, td.range * iso.ky * cam.zoom * Math.SQRT2, 0, 0, Math.PI * 2); c.stroke();
        c.setLineDash([]);
      }
    }
  };

  const drawOverlay = (c: CanvasRenderingContext2D, _S: unknown, ppm: number) => {
    const u = ppm * 0.1;
    // 白天主屋 / 厢房屋脊冒炊烟（快天黑时最浓，夜里散掉）；夜里稻田边几点萤火
    const dayA = 1 - nightA;
    for (const b of g.buildings.values()) {
      if (b.category === "house" || b.kind === "wing_room") {
        const stem = spriteFor(b);
        const hgt = (stem ? atlas.sprites[stem]?.actual_height_m : undefined) ?? 3;
        const dusk = g.phase === "day" && g.dayLeft < 12 ? 1.4 : 1;
        const sp = S((b.i + b.w * 0.65) * T, (b.j + b.d * 0.55) * T, hgt * 0.92);
        drawChimneySmoke(c, sp, u, clock + b.id * 2.3, dayA * dusk);
      } else if (b.kind === "farm_rice" && nightA > 0.3) {
        drawFireflies(c, S((b.i + b.w / 2) * T, (b.j + b.d / 2) * T, 0.6), ppm * 0.9, clock, b.id, (nightA - 0.3) / 0.7, u);
      }
    }
    // 夜里灯笼光晕轻轻闪：位置与烘培夜灯一致（正面偏左、约 0.4 倍高）
    if (nightA > 0.05) {
      const flick = (seed: number) => 0.82 + 0.12 * Math.sin(clock * 8.3 + seed * 1.7) + 0.06 * Math.sin(clock * 21 + seed * 3.1);
      for (const b of g.buildings.values()) {
        if (b.category === "wall" || b.category === "trap" || b.kind === "farm_rice" || b.kind === "fish_weir") continue;
        const stem = spriteFor(b);
        const hgt = (stem ? atlas.sprites[stem]?.actual_height_m : undefined) ?? 2.4;
        const front = Math.max(1.2, (Math.max(b.w, b.d) * T / 2) * 0.88);
        const lz = b.category === "tower" ? hgt * 0.62 : Math.max(1.0, hgt * 0.38);
        const p = S((b.i + b.w / 2) * T - front * 0.25, (b.j + b.d / 2) * T - front * 0.95, lz);
        drawLampGlow(c, p, ppm * (b.w >= 2 ? 1.6 : 1.1), nightA * flick(b.id));
      }
      for (const l of lanterns) drawLampGlow(c, S((l.i + 0.5) * T, (l.j + 0.5) * T, 1.15), ppm * 0.9, nightA * flick(l.i * 7 + l.j));
      for (const bz of braziers) drawLampGlow(c, S((bz.i + 0.5) * T, (bz.j + 0.5) * T, 1.3), ppm * 1.5, nightA * flick(bz.i * 5 + bz.j) * 1.2);
    }
    // 着火的建筑冒火（精灵本身是静态的，火焰叠在屋顶上）；夜里受损的建筑头顶显示血条（主屋看顶栏）
    for (const b of g.buildings.values()) {
      const stem = spriteFor(b);
      const height = (stem ? atlas.sprites[stem]?.actual_height_m : undefined) ?? 2.4;
      const cx = (b.i + b.w / 2) * T, cy = (b.j + b.d / 2) * T;
      if (b.burnUntil > g.t) {
        // 大建筑烧成几处火头，散在屋面上；后面的先画
        const spots = b.w * b.d >= 4 ? [[-0.45, 0.35, 0.9], [0.4, -0.3, 1.1], [0.05, 0.05, 0.75]] : [[0, 0, 1]];
        for (const [ox, oy, sz] of spots.sort((a, b2) => (b2[0]! - b2[1]!) - (a[0]! - a[1]!))) {
          drawFlames(c, S(cx + ox! * b.w * T * 0.5, cy + oy! * b.d * T * 0.5, height * 0.55), u, clock + b.id * 0.37 + ox! * 3, sz!);
        }
      }
      if (b.id !== g.houseId && b.hp < b.maxHp && g.phase === "night" && b.category !== "trap") {
        drawHpBar(c, S(cx, cy, height + 0.45), ppm * 0.7 * Math.min(2, Math.max(b.w, b.d)), b.hp / b.maxHp);
      }
    }
    for (let k = fx.length - 1; k >= 0; k--) {
      const f = fx[k]!;
      const age = clock - f.t0;
      if (age > f.life) { fx.splice(k, 1); continue; }
      if (f.kind === "smoke") drawSmoke(c, S(f.x, f.y), u, age, f.life);
      else if (f.kind === "flee") {
        // 冒烟逃跑：敌人掉头往山外跑，边跑边淡出（不画血腥的倒地）
        const meta = animIndex?.chars[f.enemy!], img = anims.get(f.enemy!);
        if (meta && img) {
          const k = age / f.life;
          const x = f.x + f.vx! * age, y = f.y + f.vy! * age;
          const face = facingFromScreenDelta(f.vx! + f.vy!, f.vx! - f.vy!, { dir: "front", flip: false });
          c.save(); c.globalAlpha = (1 - k) * 0.9;
          drawAnimFrame(c, meta, img, S(x, y), ppm, CHAR_SCALE, face.dir, face.flip, clock * 2.2, nightA, "walk");
          c.restore();
        }
      }
      else if (f.kind === "text") drawFloatText(c, S(f.x, f.y, 2.2), f.text!, f.color!, age, f.life, Math.max(11, u * 2.6));
      else drawArrow(c, S(f.fromX!, f.fromY!, 4.6), S(f.x, f.y, 0.8), Math.min(1, age / f.life), u, !!f.fire);
    }
  };

  // ---------------------------------------------------------------- 事件 → 特效 / 提示
  const handleEvents = () => {
    for (const e of drainEvents(g)) {
      if (e.type === "hit") hitAt.set(e.target, clock);
      else if (e.type === "shot") {
        const b = g.buildings.get(e.tower);
        if (b) fx.push({ kind: "arrow", fromX: (b.i + b.w / 2) * T, fromY: (b.j + b.d / 2) * T, x: e.x, y: e.y, t0: clock, life: 0.35 / speed, fire: b.kind === "tower_oil_fire" });
      } else if (e.type === "enemyFled") {
        // 掉头往离主屋更远的方向跑
        const h = g.buildings.get(g.houseId);
        const ax = h ? e.x - (h.i + h.w / 2) * T : 1, ay = h ? e.y - (h.j + h.d / 2) * T : 0;
        const al = Math.hypot(ax, ay) || 1, fleeSpeed = 4.5;
        if (animIndex?.chars[e.enemy]) fx.push({ kind: "flee", enemy: e.enemy, x: e.x, y: e.y, vx: (ax / al) * fleeSpeed, vy: (ay / al) * fleeSpeed, t0: clock, life: 0.8 });
        fx.push({ kind: "smoke", x: e.x, y: e.y, t0: clock, life: 0.9 });
        if (e.reward.coin) fx.push({ kind: "text", x: e.x, y: e.y, t0: clock, life: 1.1, text: `+${e.reward.coin}`, color: "#d9a838" });
        lastPos.delete(e.id); facing.delete(e.id); animFacing.delete(e.id); hitAt.delete(e.id);
      } else if (e.type === "nightStart") toast(e.title);
      else if (e.type === "married") toast("修好青瓦正房，迎娶阿莲！");
      else if (e.type === "peddler") toast("货郎进山了！可以卖掉余粮余木");
      else if (e.type === "birth") toast(`厢房添丁：${e.name}`);
      else if (e.type === "grownUp") toast(`${e.name}长成少年：${cfg.family.roles[e.role]?.name}`);
      else if (e.type === "buildingDestroyed") toast(`${cfg.defense.towers[e.kind]?.name ?? cfg.economy.buildings[e.kind]?.name ?? cfg.defense.walls[e.kind]?.name ?? "建筑"}被毁！`);
      else if (e.type === "dawn") toast(`天亮了 · 收获 ${costText(e.reward)}${e.starved ? " · 口粮不够！" : ""}`);
      else if (e.type === "victory") banner("击退黑风大当家\n深山传家 · 大获全胜");
      else if (e.type === "defeat") banner(`第${NUM[e.night] ?? e.night}夜 · 寨破`);
    }
  };

  // ---------------------------------------------------------------- 主循环
  // ?bg=1（仅开发调试）：页面在后台时 requestAnimationFrame 会停，改用定时器驱动，方便自动化截图
  const nextFrame = (cb: (t: number) => void) => (qs.get("bg") === "1" ? setTimeout(() => cb(performance.now()), 60) : platform.requestFrame(cb));
  renderBottom();
  fit();
  let last = performance.now(), uiT = 0;
  const frame = (now: number) => {
    // 自动模式允许大步长（后台标签页被降帧时也能推进；模拟内部仍按 1/30 秒定步长）
    const dt = Math.min(auto ? 1.0 : 0.1, (now - last) / 1000);
    last = now;
    clock += dt;
    if (auto && g.phase === "day") { autoTimer -= dt * speed; if (autoTimer <= 0) { botDay(g); autoTimer = 4; } }
    if (auto && g.phase === "day" && g.dayLeft > 3 && g.day > 0) step(g, dt * speed * 3); else step(g, dt * speed);
    handleEvents();
    syncVillagers(dt);
    const target = g.phase === "night" ? 1 : g.phase === "day" && g.dayLeft < 5 ? ((5 - g.dayLeft) / 5) * 0.75 : 0;
    nightA += Math.sign(target - nightA) * Math.min(Math.abs(target - nightA), dt * 0.8);
    syncScene();
    const { w, h } = platform.screenSize();
    renderer.render(scene, cam, nightA, { w, h, dpr: platform.pixelRatio() }, { ground, paper, drawDecals, drawOverlay });
    uiT -= dt;
    if (uiT <= 0) { renderTop(); renderBottom(); if (selected !== null) renderPanel(); uiT = 0.25; }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.style.opacity = "0"; }
    nextFrame(frame);
  };
  nextFrame(frame);
}

boot().catch((e) => {
  document.body.innerHTML = `<pre style="color:#ffb4a8;padding:12px;white-space:pre-wrap">启动失败：${e instanceof Error ? e.stack : String(e)}</pre>`;
  console.error(e);
});
