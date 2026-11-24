/**
 * 游戏本体：T4 玩法核心（src/game）+ T3 渲染底座（src/render）+ 程序化墨线占位（inkDraw）+ 画布 UI（ui.ts）。
 * 与平台无关：浏览器开发台（src/demo/main.ts → play.html）和微信小游戏（src/minigame/main.ts）都调 runApp。
 * 操作：底栏选建筑 → 点地块放置（绿色可放、红色不可）；拖动平移、双指 / 滚轮缩放；点“入夜”开战。
 */
import type { ImageLike, Platform, PointerEvt } from "../platform/platform";
import { IsoProjection, type Vec2 } from "../render/iso";
import { DEFAULT_GROUND, IsoRenderer, type Camera, type SpriteImages } from "../render/renderer";
import { Scene } from "../render/scene";
import type { SpriteAtlasIndex } from "../render/spriteMeta";
import { paintGround, paintPaper, parseGroundMap, paintBackdrop, THEME_SKY, type ThemeId } from "../render/groundPainter";
import { defaultConfig, parseFp, type Cost } from "../game/config";
import {
  assignWork, build, buildCost, canBuildAt, createGame, drainEvents, garrison, kindInfo, repairAll, repairCost, startNight, step, upgrade, upgradeHouse,
  canAfford, sellToPeddler, adOffers, adReward, type AdKind, type Building, type GameState,
} from "../game/sim";
import { botDay, botFamily } from "../game/bot";
import { drawAnimFrame, facingFromScreenDelta, type AnimImages, type AnimIndex } from "../render/animSprites";
import {
  drawArrow, drawEnemy, drawFarmDecal, drawFence, drawFloatText, drawFlames, drawHouseLike, drawChimneySmoke, drawFireflies, drawHpBar, drawLampGlow, drawSmoke, drawTrapDecal, drawWeirDecal,
  isoBox, hipRoof, PAL, tone, type ToScreen,
} from "./inkDraw";
import { COLORS, FONT, KAI, Ui, drawRich, font, richW, roundRect, wrapRich, type ButtonSpec, type Rect, type Rich } from "./ui";
import { RES_KINDS, RES_ZH } from "./icons";

export interface AppOptions {
  /** 资源目录（相对 assets/），默认 "dev" */
  assetDir?: string;
  theme?: ThemeId;
  seed?: number;
  /** 平衡 AI 自己玩（看效果用） */
  auto?: boolean;
  speed?: number;
  /** 开局多给资源（截图看后期建筑用，不影响平衡） */
  rich?: boolean;
  /** 页面在后台时 requestAnimationFrame 会停：改用定时器驱动（仅开发调试截图用） */
  timerFrames?: boolean;
  /** 封面上的操作提示 */
  coverTip?: string;
}

/** 敌人画得比真实比例大一些（手机上要一眼看清是狼是匪），只影响画面不影响判定 */
const ENEMY_SCALE = 1.7;
/** 烘培序列帧角色的放大倍数（同理：比真实比例大一些更易读；2026-11-24 试过 1.8，用户选定保留 1.45） */
const CHAR_SCALE = 1.45;
const NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
/** 建造按钮上的缩略图：玩法 id → 精灵（没有就不显示） */
const TOOL_THUMB: Record<string, string> = {
  tower_bamboo: "tower_bamboo", fence_wood: "fence_wood_a0", trap_bear: "trap_bear", farm_rice: "farm_rice_ripe", fish_weir: "fish_weir",
  hunt_lodge: "hunt_lodge", wing_room: "house_wing_room", tower_oil_fire: "tower_oil_fire",
};
const TOOLS: { kind: string; label: string }[] = [
  { kind: "tower_bamboo", label: "竹箭楼" }, { kind: "fence_wood", label: "篱笆" }, { kind: "trap_bear", label: "捕兽夹" },
  { kind: "farm_rice", label: "稻田" }, { kind: "fish_weir", label: "鱼梁" }, { kind: "hunt_lodge", label: "猎棚" },
  { kind: "wing_room", label: "厢房" }, { kind: "tower_oil_fire", label: "火油塔" },
];

interface Fx { kind: "smoke" | "text" | "arrow" | "flee"; enemy?: string; vx?: number; vy?: number; x: number; y: number; z?: number; t0: number; life: number; text?: string; color?: string; fromX?: number; fromY?: number; fire?: boolean }

/** 启动画面：旧绢底 + 标题 + 进度条（小游戏里加载全部精灵要几秒） */
function drawLoading(platform: Platform, ctx: CanvasRenderingContext2D, frac: number, msg = "进山中…"): void {
  const dpr = platform.pixelRatio();
  const { w, h } = platform.screenSize();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#e9dfc6";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = COLORS.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 44px ${KAI}`;
  ctx.fillText("深山传家", w / 2, h * 0.4);
  const bw = Math.min(240, w * 0.6), bx = w / 2 - bw / 2, by = h * 0.4 + 52;
  roundRect(ctx, bx, by, bw, 8, 4);
  ctx.fillStyle = COLORS.hpBack; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = COLORS.ink; ctx.stroke();
  if (frac > 0) { roundRect(ctx, bx, by, bw * Math.min(1, frac), 8, 4); ctx.fillStyle = COLORS.cinnabar; ctx.fill(); }
  ctx.font = font(12);
  ctx.fillStyle = COLORS.ink;
  ctx.globalAlpha = 0.7;
  ctx.fillText(msg, w / 2, by + 26);
  ctx.globalAlpha = 1;
}

export function drawFatal(platform: Platform, e: unknown): void {
  const canvas = platform.mainCanvas();
  const ctx = canvas.getContext("2d")!;
  const dpr = platform.pixelRatio();
  const { w, h } = platform.screenSize();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#1b1410";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#ffb4a8";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = font(12);
  const text = "启动失败：" + (e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));
  let y = 16;
  for (const line of text.split("\n").slice(0, 30)) {
    for (const part of wrapRich(ctx, [line], 12, w - 24)) { drawRich(ctx, part, 12, y + 8, 12, "#ffb4a8"); y += 17; }
  }
  console.error(e);
}

export async function runApp(platform: Platform, opts: AppOptions = {}): Promise<void> {
  const THEME: ThemeId = opts.theme ?? "aged";
  const ASSET_DIR = opts.assetDir ?? "dev";
  const A = (p: string) => platform.asset(`${ASSET_DIR}/${p}`);
  const canvas = platform.mainCanvas();
  const ctx = canvas.getContext("2d")!;
  {
    const dpr = platform.pixelRatio(), { w, h } = platform.screenSize();
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  drawLoading(platform, ctx, 0);

  const atlas = await platform.loadJson<SpriteAtlasIndex>(A("sprites.json"));
  let animIndex: AnimIndex | null = null;
  try { animIndex = await platform.loadJson<AnimIndex>(A("chars/chars.json")); } catch { animIndex = null; }

  // 加载全部精灵，边加载边画进度
  let total = 0, done = 0;
  const L = (f: string): Promise<ImageLike> => {
    total++;
    return platform.loadImage(A(f)).then((img) => { done++; drawLoading(platform, ctx, done / total); return img; });
  };
  const images = new Map<string, SpriteImages>();
  const anims = new Map<string, AnimImages>();
  await Promise.all([
    ...Object.entries(atlas.sprites).map(async ([stem, m]) => {
      const [day, night, shadow] = await Promise.all([L(m.day_file), L(m.night_file), m.shadow_file ? L(m.shadow_file) : Promise.resolve(undefined)]);
      images.set(stem, { day, night, shadow });
    }),
    ...Object.entries(animIndex?.chars ?? {}).map(async ([id, m]) => {
      const C = (f: string) => L(`chars/${f}`);
      const [fd, fn, bd, bn] = await Promise.all([C(m.dirs.front.day), C(m.dirs.front.night), C(m.dirs.back.day), C(m.dirs.back.night)]);
      const entry: AnimImages = { front: { day: fd, night: fn }, back: { day: bd, night: bn }, actions: {} };
      await Promise.all(Object.entries(m.actions ?? {}).filter(([act]) => act !== "walk").map(async ([act, a]) => {
        const [afd, afn, abd, abn] = await Promise.all([C(a.dirs.front.day), C(a.dirs.front.night), C(a.dirs.back.day), C(a.dirs.back.night)]);
        entry.actions![act] = { front: { day: afd, night: afn }, back: { day: abd, night: abn } };
      }));
      anims.set(id, entry);
    }),
  ]);

  const cfg = defaultConfig();
  const seed = opts.seed ?? 7;
  let g: GameState = createGame(cfg, seed);
  if (opts.rich) Object.assign(g.res, { coin: 9000, wood: 3000, food: 800, hide: 120 });
  const T = cfg.tileSize;
  const iso = new IsoProjection({ pxPerMeter: atlas.px_per_meter, tileSize: T, elevationDeg: 30 });
  const map = parseGroundMap(cfg.map.terrain);
  const off = (w: number, h: number) => platform.createOffscreen(w, h);
  const ground = { day: paintGround(off, map, atlas.px_per_meter, false, 11, 2, THEME), night: paintGround(off, map, atlas.px_per_meter, true, 11, 2, THEME) };
  const paper = paintPaper(off, 256, 7, THEME);
  const renderer = new IsoRenderer(ctx, iso, images, { ...DEFAULT_GROUND, sky: THEME_SKY[THEME] });
  const ui = new Ui();

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

  // ---------------------------------------------------------------- 状态
  let tool: string | null = null;
  let hoverTile: { i: number; j: number } | null = null;
  let selected: number | null = null;
  const auto = !!opts.auto;
  let speed = opts.speed ?? 1;
  // 封面：自动模式直接开始；否则点“开荒”前模拟不走（画面照常渲染当背景）
  let started = auto;
  let familyOpen = false;
  let bannerText: string | null = null;
  let toastMsg = "", toastT = 0;
  const toast = (msg: string) => { toastMsg = msg; toastT = 2.6; };
  let nightA = 0;
  let clock = 0;
  const fx: Fx[] = [];
  const lastPos = new Map<number, Vec2>();
  const facing = new Map<number, number>();
  const animFacing = new Map<number, { dir: "front" | "back"; flip: boolean }>();
  /** 敌人最近一次被打中的时刻（受击闪白） */
  const hitAt = new Map<number, number>();

  // ---------------------------------------------------------------- 画布 UI 布局（顶栏 / 底栏的位置也决定相机框住的可视区）
  const layout = { topBottom: 60, bottomTop: 400 };
  const thumb = (stem: string | undefined) => (stem ? images.get(stem)?.day ?? null : null);
  const costRich = (c: Cost | null | undefined): Rich => {
    const out: Rich = [];
    if (c) for (const [k, v] of Object.entries(c)) if (v) { if (out.length) out.push(" "); out.push({ icon: k }, `${v}`); }
    return out;
  };
  const costPlain = (c: Cost | null | undefined) => c ? Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${v}${RES_ZH[k]}`).join(" ") : "";

  // ---------------------------------------------------------------- 相机
  const cam: Camera = { x: 0, y: 0, zoom: 1 };
  let fitZoom = 1;
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
    // 可视区 = 顶栏下沿到底栏上沿
    const topY = layout.topBottom + 4, botY = layout.bottomTop - 4;
    const usableH = Math.max(100, botY - topY);
    cam.zoom = fitZoom = Math.min((w * 1.15) / (maxX - minX), usableH / (maxY - minY));
    cam.x = w / 2 - ((minX + maxX) / 2) * cam.zoom;
    cam.y = topY + usableH / 2 - ((minY + maxY) / 2) * cam.zoom;
  };
  const resize = () => {
    const dpr = platform.pixelRatio();
    const { w, h } = platform.screenSize();
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    measureUi();
    fit();
  };
  platform.onResize(resize);
  const S: ToScreen = (x, y, z = 0) => { const p = iso.worldToScreen({ x, y, z }); return { x: cam.x + p.x * cam.zoom, y: cam.y + p.y * cam.zoom }; };

  // 开发台截图用：控制台里 __demo.speed = 1 / __demo.g 查看状态（只在 dev server 里存在）
  if (import.meta.env?.DEV) {
    Object.defineProperty(globalThis, "__demo", { configurable: true, value: { get g() { return g; }, get villagers() { return villagers; }, get cam() { return cam; }, get speed() { return speed; }, set speed(v: number) { speed = v; } } });
  }

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

  // ---------------------------------------------------------------- 底栏按钮（每帧按状态生成）
  const bottomButtons = (): ButtonSpec[] => {
    const day = g.phase === "day";
    const out: ButtonSpec[] = TOOLS.map((t) => {
      const info = kindInfo(cfg, t.kind)!;
      return {
        key: `tool:${t.kind}`, label: t.label, thumb: thumb(TOOL_THUMB[t.kind]), sub: costRich(buildCost(g, t.kind)), on: tool === t.kind,
        disabled: !day || (info.requires === "married" && !g.married),
        onClick: () => { tool = tool === t.kind ? null : t.kind; selected = null; },
      };
    });
    const next = g.houseLevel === 1 ? cfg.economy.house.lv2 : g.houseLevel === 2 ? cfg.economy.house.lv3 : null;
    out.push(next
      ? { key: "house", label: g.houseLevel === 1 ? "修房娶妻" : "扩建大院", thumb: thumb(g.houseLevel === 1 ? "house_lv2_tile" : "house_lv3_courtyard"), sub: costRich(next.cost),
        disabled: !day || !canAfford(g, next.cost), onClick: () => { const r = upgradeHouse(g); if (!r.ok) toast(r.reason); } }
      : { key: "house", label: "大院已成", disabled: true, onClick: () => {} });
    const rc = repairCost(g);
    out.push({ key: "repair", label: "修补", sub: (rc.coin ?? 0) > 0 ? costRich(rc) : ["完好"], disabled: !day || (rc.coin ?? 0) === 0 || !canAfford(g, rc), onClick: () => repairAll(g) });
    out.push({ key: "family", label: "安排家人", sub: [`${g.members.length + 1} 口`], on: familyOpen, onClick: () => { familyOpen = !familyOpen; } });
    // 货郎：来访的白天出现，一键卖掉结余（留两天口粮、100 木）
    if (day && g.peddler) out.push({
      key: "peddler", label: "货郎进山", sub: [`卖余粮余木${g.ads.priceMul > 1 ? " ×2" : ""}`],
      onClick: () => {
        const keep = { food: (1 + g.members.length) * cfg.economy.upkeep.foodPerMemberPerDawn * 2 + 30, wood: 100 };
        const before = g.res.coin;
        for (const r of ["food", "wood"] as const) { const n = Math.floor(g.res[r] - keep[r]); if (n > 0) sellToPeddler(g, r, n); }
        toast(g.res.coin > before ? `卖给货郎，得 ${Math.floor(g.res.coin - before)} 钱` : "没有多余的粮木可卖");
      },
    });
    // 激励视频（演示里直接模拟看完；接 wx.createRewardedVideoAd 时改这里）
    for (const kind of ["good_harvest", "rich_peddler", "double_happiness", "last_stand"] as AdKind[]) {
      const offer = adOffers(g).find((o) => o.kind === kind)!;
      if (!offer.available) continue;
      out.push({ key: `ad:${kind}`, label: `▶ ${offer.name}`, sub: ["看广告"], primary: kind === "last_stand",
        onClick: () => { const r = adReward(g, kind); toast(r.ok ? `▶ ${cfg.economy.ads[kind].name}（演示：模拟看完广告）` : r.reason); } });
    }
    out.push({ key: "speed", label: `${speed}× 速度`, onClick: () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; } });
    out.push(day
      ? { key: "night", label: "入夜 ▶", sub: [`还有 ${Math.ceil(g.dayLeft)} 秒天黑`], primary: true, onClick: () => { startNight(g); tool = null; } }
      : { key: "night", label: "守夜中", sub: [`${g.enemies.length + g.spawnQueue.length} 敌`], primary: true, disabled: true, onClick: () => {} });
    return out;
  };

  // ---------------------------------------------------------------- 顶栏
  const topTitle = () => g.phase === "night" ? `第${NUM[g.day] ?? g.day}夜 · ${cfg.waves.nights[g.day - 1]?.title.split("·")[1]?.trim() ?? "无尽"}`
    : g.phase === "day" ? `第${NUM[g.day] ?? g.day}天 · 白昼` : g.phase === "victory" ? "大获全胜" : "寨破";
  const drawTop = (draw: boolean): number => {
    const c = ui.c, ins = platform.safeInsets();
    const x = 8, y = ins.top + 8, w = ui.w - 16;
    const title = topTitle();
    const res: Rich = [];
    for (const k of RES_KINDS) { if (res.length) res.push("  "); res.push({ icon: k }, `${Math.floor(g.res[k])}`); }
    const tw = c ? (c.font = font(15, true), c.measureText(title).width) : 0;
    const rw = richW(c, res, 13);
    const oneRow = tw + rw + 12 <= w - 16;
    const h = 6 + 20 + (oneRow ? 0 : 18) + 4 + 6 + 6;
    if (draw) {
      ui.block("top", { x, y, w, h });
      ui.panel({ x, y, w, h });
      c.font = font(15, true); c.fillStyle = COLORS.ink; c.textAlign = "left"; c.textBaseline = "middle";
      c.fillText(title, x + 8, y + 16);
      if (oneRow) drawRich(c, res, x + w - 8 - rw, y + 16, 13, COLORS.ink);
      else drawRich(c, res, x + 8, y + 34, 13, COLORS.ink);
      const by = y + h - 12, bw = w - 16;
      const house = g.buildings.get(g.houseId);
      roundRect(c, x + 8, by, bw, 6, 3); c.fillStyle = COLORS.hpBack; c.fill();
      if (house && house.hp > 0) { c.save(); roundRect(c, x + 8, by, bw, 6, 3); c.clip(); c.fillStyle = COLORS.cinnabar; c.fillRect(x + 8, by, (bw * house.hp) / house.maxHp, 6); c.restore(); }
      roundRect(c, x + 8, by, bw, 6, 3); c.lineWidth = 1; c.strokeStyle = COLORS.ink; c.stroke();
    }
    return y + h;
  };

  // ---------------------------------------------------------------- 底栏
  const drawBottom = (draw: boolean): number => {
    const ins = platform.safeInsets();
    const x = 8, w = ui.w - 16;
    const btns = bottomButtons();
    const innerH = ui.flow(btns, x + 8, 0, w - 16, 6, false);
    const h = innerH + 12;
    const y = ui.h - ins.bottom - 8 - h;
    if (draw) {
      ui.block("bottom", { x, y, w, h });
      ui.panel({ x, y, w, h });
      ui.flow(btns, x + 8, y + 6, w - 16, 6, true);
    }
    return y;
  };

  // ---------------------------------------------------------------- 建筑信息面板（点已有建筑）
  const drawInfo = () => {
    const b = selected !== null ? g.buildings.get(selected) : undefined;
    if (!b) { selected = null; return; }
    const c = ui.c;
    const name = cfg.defense.towers[b.kind]?.name ?? cfg.defense.walls[b.kind]?.name ?? cfg.economy.buildings[b.kind]?.name ?? (b.category === "house" ? cfg.economy.house[`lv${g.houseLevel}` as "lv1"].name : b.kind);
    const crew = g.members.filter((m) => m.post === b.id).map((m) => `${m.name}（${cfg.family.roles[m.role ?? ""]?.bond.name ?? ""}）`);
    const up = cfg.defense.towers[b.kind]?.upgrade ?? cfg.defense.walls[b.kind]?.upgrade;
    const upDef = up ? cfg.defense.towers[up] ?? cfg.defense.walls[up] : null;
    // 放在提示条（顶栏下 10px、高 30px）下面，免得两者重叠
    const w = Math.max(170, ui.w * 0.46), x = ui.w - 8 - w, y = layout.topBottom + 48;
    const lines: Rich[] = [[{ b: name }, `　${Math.round(b.hp)}/${b.maxHp}`]];
    if (crew.length) lines.push(...wrapRich(c, [`驻守：${crew.join("、")}`], 12, w - 16));
    const btn: ButtonSpec[] = upDef ? [{ key: `up:${b.id}`, label: `升级为${upDef.name}`, sub: costRich(upDef.cost), disabled: g.phase !== "day",
      onClick: () => { const r = upgrade(g, b.id); toast(r.ok ? `已升级为${upDef.name}` : r.reason); } }] : [];
    btn.push({ key: "info:close", label: "收起", onClick: () => { selected = null; } });
    const bh = ui.flow(btn, 0, 0, w - 16, 6, false);
    const h = 8 + lines.length * 18 + 4 + bh + 8;
    ui.block("info", { x, y, w, h });
    ui.panel({ x, y, w, h });
    lines.forEach((l, k) => drawRich(c, l, x + 8, y + 8 + 9 + k * 18, 12, COLORS.ink));
    ui.flow(btn, x + 8, y + 8 + lines.length * 18 + 4, w - 16, 6, true);
  };

  // ---------------------------------------------------------------- 家族面板：子女分工（长成那天的分工定身份）、少年驻守
  const WORKS: { work: string; label: string }[] = [
    { work: "hunt_lodge", label: "打猎" }, { work: "farmer", label: "砍柴" }, { work: "fish_weir", label: "打渔" }, { work: "farm_rice", label: "种田" },
  ];
  const ROLE_OF_WORK: Record<string, string> = Object.fromEntries(Object.entries(cfg.family.roles).map(([id, r]) => [r.work, id]));
  const bName = (b: Building) => cfg.defense.towers[b.kind]?.name ?? cfg.defense.walls[b.kind]?.name ?? (b.category === "house" ? "主屋" : b.kind);
  const postsFor = (slot: string) => [...g.buildings.values()].filter((b) => (slot === "tower" ? b.category === "tower" : slot === "wall" ? b.category === "wall" : b.category === "house"));
  const SLOT_ZH: Record<string, string> = { tower: "塔", wall: "墙", house: "主屋" };
  /** 家族面板内容：一行说明 + 若干按钮；draw=false 只量高度 */
  const familyRows = (): { text: Rich; buttons: ButtonSpec[] }[] => {
    const rows: { text: Rich; buttons: ButtonSpec[] }[] = [];
    rows.push({ text: [{ b: "家族" }, "　", { dim: "白天分工产出加成；长成少年那天的分工定身份；少年驻守触发羁绊" }], buttons: [] });
    rows.push({ text: [{ b: cfg.family.hero.name }, "　白天下田干活 · 夜里守在主屋门口补刀"], buttons: [] });
    if (g.married) rows.push({ text: [{ b: cfg.family.wife.name }, "　白天自动收割 · 夜里熬汤回血"], buttons: [] });
    else rows.push({ text: [{ dim: "（未成家）" }, "　修好青瓦正房即迎娶阿莲"], buttons: [] });
    for (const m of g.members.filter((x) => x.kind === "child")) {
      if (!m.role) {
        const left = Math.max(0, cfg.family.growth.daysToYouth - (g.day - m.bornDay));
        rows.push({
          text: [{ b: m.name }, "　", { dim: `幼年 · ${left > 0 ? `再过 ${left} 个黎明长成` : "明早长成"} → 将成${cfg.family.roles[ROLE_OF_WORK[m.work] ?? ""]?.name ?? "？"}` }],
          buttons: WORKS.map((w) => ({ key: `work:${m.id}:${w.work}`, label: w.label, on: m.work === w.work, onClick: () => { const res = assignWork(g, m.id, w.work); if (!res.ok) toast(res.reason); } })),
        });
      } else {
        const role = cfg.family.roles[m.role]!;
        const posts = postsFor(role.bond.slot);
        const slot = SLOT_ZH[role.bond.slot] ?? "";
        rows.push({
          text: [{ b: m.name }, "　", { dim: `${role.name} · 羁绊「${role.bond.name}」驻${slot}` }, ...(posts.length ? [] : ["　", { dim: `还没有可驻守的${slot}` }])],
          buttons: [
            { key: `post:${m.id}:none`, label: "不驻守", on: m.post === null, onClick: () => garrison(g, m.id, null) },
            ...posts.slice(0, 6).map((b) => ({ key: `post:${m.id}:${b.id}`, label: `${bName(b)}#${b.id}`, on: m.post === b.id, onClick: () => { const res = garrison(g, m.id, b.id); if (!res.ok) toast(res.reason); } })),
          ],
        });
      }
    }
    if (!g.members.some((x) => x.kind === "child")) rows.push({ text: [{ dim: "成家后建厢房，每个黎明添丁" }], buttons: [] });
    rows.push({ text: [], buttons: [
      { key: "fam:auto", label: "一键安排", onClick: () => { const log = botFamily(g); toast(log[log.length - 1] ?? "家人已各就各位"); } },
      { key: "fam:close", label: "收起", onClick: () => { familyOpen = false; } },
    ] });
    return rows;
  };
  const drawFamily = () => {
    const c = ui.c;
    const x = 8, w = ui.w - 16, innerW = w - 16;
    const rows = familyRows();
    const layoutRows = rows.map((r) => ({ lines: r.text.length ? wrapRich(c, r.text, 12, innerW) : [], buttons: r.buttons, bh: r.buttons.length ? ui.flow(r.buttons, 0, 0, innerW, 4, false) : 0 }));
    const rowH = (r: typeof layoutRows[0]) => r.lines.length * 18 + (r.buttons.length ? r.bh + (r.lines.length ? 3 : 0) : 0);
    const contentH = layoutRows.reduce((s, r) => s + rowH(r) + 6, 0) - 6;
    const maxH = ui.h * 0.46;
    const h = Math.min(maxH, contentH + 16);
    const y = layout.bottomTop - 8 - h;
    ui.block("family", { x, y, w, h });
    ui.panel({ x, y, w, h });
    const view: Rect = { x, y: y + 6, w, h: h - 12 };
    const s = ui.scrollArea("family", { x, y, w, h }, contentH + 4);
    c.save();
    c.beginPath(); c.rect(view.x, view.y, view.w, view.h); c.clip();
    ui.clip = view;
    let cy = y + 8 - s;
    for (const r of layoutRows) {
      for (const l of r.lines) { drawRich(c, l, x + 8, cy + 9, 12, COLORS.ink); cy += 18; }
      if (r.buttons.length) { if (r.lines.length) cy += 3; ui.flow(r.buttons, x + 8, cy, innerW, 4, true); cy += r.bh; }
      cy += 6;
    }
    ui.clip = null;
    c.restore();
    // 内容超出时右侧一道细滚动条
    if (contentH + 4 > h) {
      const k = h / (contentH + 4), th = Math.max(20, (h - 12) * k), ty = y + 6 + (h - 12 - th) * (s / Math.max(1, contentH + 4 - h));
      roundRect(c, x + w - 6, ty, 3, th, 1.5); c.fillStyle = "rgba(28,21,16,0.35)"; c.fill();
    }
  };

  // ---------------------------------------------------------------- 封面 / 结局横幅
  const drawCover = () => {
    const c = ui.c, W = ui.w, H = ui.h;
    ui.block("cover", { x: 0, y: 0, w: W, h: H });
    const grad = c.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.7);
    grad.addColorStop(0, "rgba(241,232,212,0.55)"); grad.addColorStop(1, "rgba(26,37,80,0.55)");
    c.fillStyle = grad; c.fillRect(0, 0, W, H);
    const cw = W * 0.74, innerW = cw - 36;
    const lines = wrapRich(c, ["流落深山，白天开荒种田、攒钱娶妻生子；", "\n", "入夜举家上楼，守住这一方寨子。"], 14, innerW);
    const tip = wrapRich(c, [opts.coverTip ?? "底栏选建筑 → 点地块放置 · 拖动看地图 · 点“入夜”开战"], 11, innerW);
    const ch = 26 + 52 + 22 + lines.length * 25 + 14 + 42 + 12 + tip.length * 15 + 18;
    const cx = W / 2 - cw / 2, cy = H / 2 - ch / 2;
    c.save();
    c.shadowColor = "rgba(0,0,0,0.35)"; c.shadowBlur = 30; c.shadowOffsetY = 10;
    roundRect(c, cx - 8, cy - 8, cw + 16, ch + 16, 12); c.fillStyle = COLORS.ink; c.fill();
    c.restore();
    roundRect(c, cx - 6, cy - 6, cw + 12, ch + 12, 10); c.fillStyle = "rgba(241,232,212,0.94)"; c.fill();
    roundRect(c, cx, cy, cw, ch, 6); c.fillStyle = "rgba(241,232,212,0.94)"; c.fill(); c.lineWidth = 3; c.strokeStyle = COLORS.ink; c.stroke();
    // 标题四字错落
    c.font = `700 52px ${KAI}`; c.fillStyle = COLORS.ink; c.textAlign = "center"; c.textBaseline = "middle";
    const chars = ["深", "山", "传", "家"], offs = [0, 6, 0, -4], step = 52 * 1.06;
    // 整体略偏左，给右上角的朱砂印让出位置
    chars.forEach((t, k) => c.fillText(t, W / 2 - Math.min(14, cw * 0.05) + (k - 1.5) * step, cy + 26 + 26 + offs[k]!));
    // 朱砂印
    c.save();
    c.translate(cx + cw - 12 - 23, cy + 12 + 23); c.rotate((-6 * Math.PI) / 180);
    roundRect(c, -23, -23, 46, 46, 4); c.fillStyle = COLORS.cinnabar; c.fill();
    roundRect(c, -21, -21, 42, 42, 3); c.lineWidth = 1.5; c.strokeStyle = "rgba(246,236,214,0.6)"; c.stroke();
    c.font = `15px ${KAI}`; c.fillStyle = COLORS.toastText; c.fillText("开荒", 0, -9); c.fillText("守寨", 0, 11);
    c.restore();
    let y = cy + 26 + 52 + 22;
    for (const l of lines) { const lw = richW(c, l, 14); drawRich(c, l, W / 2 - lw / 2, y + 12, 14, COLORS.ink); y += 25; }
    y += 14;
    const bw = 132, bh = 40;
    const br = { x: W / 2 - bw / 2, y, w: bw, h: bh };
    ui.button({ key: "cover:start", label: "", onClick: () => { started = true; } }, br);
    roundRect(c, br.x, br.y + 2, bw, bh, 10); c.fillStyle = COLORS.ink; c.fill();
    roundRect(c, br.x, br.y, bw, bh, 10); c.fillStyle = COLORS.cinnabar; c.fill(); c.lineWidth = 2; c.strokeStyle = COLORS.ink; c.stroke();
    if (ui.isPressed("cover:start")) { c.fillStyle = "rgba(28,21,16,0.14)"; c.fill(); }
    c.font = `17px ${FONT}`; c.fillStyle = COLORS.cream; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("开 荒 ▶", W / 2, br.y + bh / 2 + 0.5);
    y += bh + 12;
    c.globalAlpha = 0.65;
    for (const l of tip) { const lw = richW(c, l, 11); drawRich(c, l, W / 2 - lw / 2, y + 7, 11, COLORS.ink); y += 15; }
    c.globalAlpha = 1;
  };
  const drawBanner = (text: string) => {
    const c = ui.c, W = ui.w, H = ui.h;
    ui.block("banner", { x: 0, y: 0, w: W, h: H });
    c.fillStyle = "rgba(15,21,40,0.72)"; c.fillRect(0, 0, W, H);
    const lines = text.split("\n");
    c.font = font(26); c.fillStyle = COLORS.toastText; c.textAlign = "center"; c.textBaseline = "middle";
    const y0 = H / 2 - (lines.length * 36 + 14 + 38) / 2;
    lines.forEach((l, k) => c.fillText(l, W / 2, y0 + 18 + k * 36));
    const bw = 120, bh = 38, by = y0 + lines.length * 36 + 14;
    const r = { x: W / 2 - bw / 2, y: by, w: bw, h: bh };
    ui.button({ key: "banner:again", label: "", onClick: () => { g = createGame(cfg, seed + Math.floor(Math.random() * 1000)); bannerText = null; selected = null; tool = null; } }, r);
    roundRect(c, r.x, r.y, bw, bh, 10); c.fillStyle = COLORS.cinnabar; c.fill(); c.lineWidth = 2; c.strokeStyle = COLORS.toastText; c.stroke();
    if (ui.isPressed("banner:again")) { c.fillStyle = "rgba(28,21,16,0.14)"; c.fill(); }
    c.font = font(15); c.fillStyle = COLORS.cream; c.fillText("再来一局", W / 2, by + bh / 2 + 0.5);
  };

  const drawUi = () => {
    const dpr = platform.pixelRatio(), { w, h } = platform.screenSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ui.begin(ctx, w, h);
    layout.topBottom = drawTop(true);
    layout.bottomTop = drawBottom(true);
    if (familyOpen) drawFamily();
    if (selected !== null) drawInfo();
    ui.toast(toastMsg, layout.topBottom + 10, Math.min(1, toastT / 0.3));
    if (!started) drawCover();
    if (bannerText) drawBanner(bannerText);
  };
  /** 只量顶栏 / 底栏位置（相机 fit 要用） */
  const measureUi = () => {
    const { w, h } = platform.screenSize();
    ui.begin(ctx, w, h);
    layout.topBottom = drawTop(false);
    layout.bottomTop = drawBottom(false);
  };

  // ---------------------------------------------------------------- 输入：UI 优先，其次地图（单指拖动 / 点选，双指缩放）
  const touches = new Map<number, Vec2>();
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  let pinch: { d0: number; zoom0: number; mx: number; my: number; cx: number; cy: number } | null = null;
  const toTile = (x: number, y: number) => iso.screenToTile({ x: (x - cam.x) / cam.zoom, y: (y - cam.y) / cam.zoom });
  const zoomAt = (mx: number, my: number, z: number, from = { zoom: cam.zoom, cx: cam.x, cy: cam.y, mx, my }) => {
    const nz = Math.max(fitZoom * 0.7, Math.min(fitZoom * 3, z));
    const k = nz / from.zoom;
    cam.x = mx - (from.mx - from.cx) * k; cam.y = my - (from.my - from.cy) * k; cam.zoom = nz;
  };
  const tap = (x: number, y: number) => {
    const t = toTile(x, y);
    if (tool) {
      const r = build(g, tool, t.i, t.j);
      if (!r.ok) toast(r.reason);
    } else {
      selected = pickBuilding(x, y, t);
    }
  };
  /** 点选建筑：先看脚下的格子；没有就看点到了哪栋建筑的“身子”（塔楼高，手指多半点在楼身上），取最靠前的一栋 */
  const pickBuilding = (x: number, y: number, t: { i: number; j: number }): number | null => {
    const id = g.grid.occupant(t.i, t.j);
    if (id) return id;
    let best: number | null = null, bestY = -Infinity;
    for (const b of g.buildings.values()) {
      if (b.category === "trap" || b.kind === "farm_rice") continue;
      const cs = [S(b.i * T, b.j * T), S((b.i + b.w) * T, b.j * T), S((b.i + b.w) * T, (b.j + b.d) * T), S(b.i * T, (b.j + b.d) * T)];
      const stem = spriteFor(b);
      const hgt = (stem ? atlas.sprites[stem]?.actual_height_m : undefined) ?? 2.4;
      const top = S((b.i + b.w / 2) * T, (b.j + b.d / 2) * T, hgt).y;
      const x0 = Math.min(...cs.map((p) => p.x)), x1 = Math.max(...cs.map((p) => p.x)), y1 = Math.max(...cs.map((p) => p.y));
      if (x >= x0 && x <= x1 && y >= top && y <= y1 && y1 > bestY) { best = b.id; bestY = y1; }
    }
    return best;
  };
  const onPointer = (e: PointerEvt) => {
    if (e.type === "move" && !e.pressed && !touches.has(e.id)) { hoverTile = toTile(e.x, e.y); return; } // 鼠标悬停：只更新选址预览
    if (!touches.has(e.id) && ui.pointer(e)) return;
    if (e.type === "down") {
      touches.set(e.id, { x: e.x, y: e.y });
      if (touches.size === 1) { drag = { x: e.x, y: e.y, cx: cam.x, cy: cam.y, moved: false }; hoverTile = toTile(e.x, e.y); }
      else if (touches.size === 2) {
        const [a, b] = [...touches.values()] as [Vec2, Vec2];
        pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), zoom0: cam.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: cam.x, cy: cam.y };
        drag = null;
      }
      return;
    }
    if (!touches.has(e.id)) return;
    if (e.type === "move") {
      touches.set(e.id, { x: e.x, y: e.y });
      if (pinch && touches.size >= 2) {
        const [a, b] = [...touches.values()] as [Vec2, Vec2];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.zoom0 * (d / pinch.d0), { zoom: pinch.zoom0, cx: pinch.cx, cy: pinch.cy, mx: pinch.mx, my: pinch.my });
      } else if (drag) {
        const dx = e.x - drag.x, dy = e.y - drag.y;
        if (Math.hypot(dx, dy) > 6) drag.moved = true;
        if (drag.moved) { cam.x = drag.cx + dx; cam.y = drag.cy + dy; }
        else hoverTile = toTile(e.x, e.y);
      }
      return;
    }
    // up / cancel
    touches.delete(e.id);
    if (pinch) { if (touches.size < 2) pinch = null; drag = null; return; }
    const d = drag; drag = null;
    if (e.type === "up" && d && !d.moved) tap(e.x, e.y);
  };
  platform.onPointer(onPointer);
  platform.onWheel((x, y, dy) => zoomAt(x, y, cam.zoom * Math.exp(-dy * 0.0015)));

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

  // 远山背景：按屏幕尺寸缓存白昼 / 夜晚两张，入夜交叉淡入
  let backdrop: { w: number; h: number; day: HTMLCanvasElement; night: HTMLCanvasElement } | null = null;
  const drawBackdrop = (c: CanvasRenderingContext2D, w: number, h: number, a: number) => {
    if (!backdrop || backdrop.w !== w || backdrop.h !== h) backdrop = { w, h, day: paintBackdrop(off, w, h, false, 5, THEME), night: paintBackdrop(off, w, h, true, 5, THEME) };
    c.globalAlpha = 1; c.drawImage(backdrop.day, 0, 0, w, h);
    if (a > 0.002) { c.globalAlpha = a; c.drawImage(backdrop.night, 0, 0, w, h); }
    c.globalAlpha = 1;
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
      const flick = (s: number) => 0.82 + 0.12 * Math.sin(clock * 8.3 + s * 1.7) + 0.06 * Math.sin(clock * 21 + s * 3.1);
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
          const k2 = age / f.life;
          const x = f.x + f.vx! * age, y = f.y + f.vy! * age;
          const face = facingFromScreenDelta(f.vx! + f.vy!, f.vx! - f.vy!, { dir: "front", flip: false });
          c.save(); c.globalAlpha = (1 - k2) * 0.9;
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
        // 野猪掉肉（计入口粮）：第二行飘“+15 肉”
        const names = cfg.enemies[e.enemy]?.rewardNames;
        if (e.reward.food && names?.food) fx.push({ kind: "text", x: e.x + 0.4, y: e.y - 0.4, t0: clock, life: 1.3, text: `+${e.reward.food}${names.food}`, color: "#c4512e" });
        lastPos.delete(e.id); facing.delete(e.id); animFacing.delete(e.id); hitAt.delete(e.id);
      } else if (e.type === "nightStart") toast(e.title);
      else if (e.type === "married") toast("修好青瓦正房，迎娶阿莲！");
      else if (e.type === "peddler") toast("货郎进山了！可以卖掉余粮余木");
      else if (e.type === "birth") toast(`厢房添丁：${e.name}`);
      else if (e.type === "grownUp") toast(`${e.name}长成少年：${cfg.family.roles[e.role]?.name}`);
      else if (e.type === "buildingDestroyed") toast(`${cfg.defense.towers[e.kind]?.name ?? cfg.economy.buildings[e.kind]?.name ?? cfg.defense.walls[e.kind]?.name ?? "建筑"}被毁！`);
      else if (e.type === "dawn") toast(`天亮了 · 收获 ${costPlain(e.reward)}${e.starved ? " · 口粮不够！" : ""}`);
      else if (e.type === "victory") bannerText = "击退黑风大当家\n深山传家 · 大获全胜";
      else if (e.type === "defeat") bannerText = `第${NUM[e.night] ?? e.night}夜 · 寨破`;
    }
  };

  // ---------------------------------------------------------------- 主循环
  const nextFrame = (cb: (t: number) => void) => (opts.timerFrames ? setTimeout(() => cb(platform.now()), 60) : platform.requestFrame(cb));
  resize();
  let last = platform.now();
  const frame = (now: number) => {
    // requestAnimationFrame 给的时间戳和 now() 可能不是同一个钟（小游戏），统一用 now()
    now = platform.now();
    // 自动模式允许大步长（后台标签页被降帧时也能推进；模拟内部仍按 1/30 秒定步长）
    const dt = Math.max(0, Math.min(auto ? 1.0 : 0.1, (now - last) / 1000));
    last = now;
    clock += dt;
    if (auto && g.phase === "day") { autoTimer -= dt * speed; if (autoTimer <= 0) { botDay(g); autoTimer = 4; } }
    if (!started || bannerText) { /* 封面 / 结局横幅上：只渲染不推进 */ }
    else if (auto && g.phase === "day" && g.dayLeft > 3 && g.day > 0) step(g, dt * speed * 3); else step(g, dt * speed);
    handleEvents();
    syncVillagers(dt);
    const target = g.phase === "night" ? 1 : g.phase === "day" && g.dayLeft < 5 ? ((5 - g.dayLeft) / 5) * 0.75 : 0;
    nightA += Math.sign(target - nightA) * Math.min(Math.abs(target - nightA), dt * 0.8);
    if (g.phase !== "day") tool = null;
    syncScene();
    const { w, h } = platform.screenSize();
    renderer.render(scene, cam, nightA, { w, h, dpr: platform.pixelRatio() }, { ground, paper, paperAlpha: THEME === "aged" ? 1 : undefined, drawDecals, drawOverlay, drawBackdrop });
    if (toastT > 0) toastT -= dt;
    drawUi();
    nextFrame(frame);
  };
  nextFrame(frame);
}
