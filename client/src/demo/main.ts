/**
 * 竖屏可玩演示：T4 玩法核心（src/game）+ T3 渲染底座（src/render）+ 程序化墨线占位（inkDraw）。
 * 操作：底栏选建筑 → 点地块放置（绿色可放、红色不可）；拖动平移；点“入夜”开战。
 * URL：?auto=1 让平衡 AI 自己玩（看效果用），?seed=数字，?speed=2
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
  canAfford, type Building, type GameState,
} from "../game/sim";
import { botDay, botFamily } from "../game/bot";
import {
  drawArrow, drawEnemy, drawFarmDecal, drawFence, drawFloatText, drawHouseLike, drawSmoke, drawTrapDecal, drawWeirDecal,
  isoBox, hipRoof, PAL, tone, type ToScreen,
} from "./inkDraw";

/** 敌人画得比真实比例大一些（手机上要一眼看清是狼是匪），只影响画面不影响判定 */
const ENEMY_SCALE = 1.7;
const NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
const RES_ZH: Record<string, string> = { coin: "钱", wood: "木", food: "粮", hide: "兽材" };
const TOOLS: { kind: string; label: string }[] = [
  { kind: "tower_bamboo", label: "竹箭楼" }, { kind: "fence_wood", label: "篱笆" }, { kind: "trap_bear", label: "捕兽夹" },
  { kind: "farm_rice", label: "稻田" }, { kind: "fish_weir", label: "鱼梁" }, { kind: "hunt_lodge", label: "猎棚" },
  { kind: "wing_room", label: "厢房" }, { kind: "tower_oil_fire", label: "火油塔" },
];

interface Fx { kind: "smoke" | "text" | "arrow"; x: number; y: number; z?: number; t0: number; life: number; text?: string; color?: string; fromX?: number; fromY?: number; fire?: boolean }

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

  const cfg = defaultConfig();
  const seed = Number(qs.get("seed") ?? 7);
  let g: GameState = createGame(cfg, seed);
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
  const auto = qs.get("auto") === "1";
  let nightA = 0;
  let clock = 0;
  const fx: Fx[] = [];
  const lastPos = new Map<number, Vec2>();
  const facing = new Map<number, number>();
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
  const isWallAt = (i: number, j: number) => {
    const id = g.grid.occupant(i, j);
    return !!id && g.buildings.get(id)?.category === "wall";
  };
  const spriteFor = (b: Building): string | null => {
    const has = (s: string) => (atlas.sprites[s] ? s : null);
    if (b.category === "house") return g.houseLevel === 2 ? has("house_lv2_tile") : null;
    if (b.kind === "tower_bamboo" || b.kind === "tower_crossbow") return has("tower_bamboo");
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
  const syncScene = () => {
    scene.objects.length = 0;
    if (atlas.sprites.prop_pine_tree) for (const d of decor) scene.addSprite("prop_pine_tree", d.i, d.j, `pine@${d.i},${d.j}`);
    for (const b of g.buildings.values()) {
      const stem = spriteFor(b);
      if (!stem && (b.category === "trap" || b.kind === "farm_rice" || b.kind === "fish_weir")) continue; // 没有精灵的贴地物件画在贴地图层
      if (stem) { scene.addSprite(stem, b.i, b.j, `b${b.id}`); continue; }
      const cx = (b.i + b.w / 2) * T, cy = (b.j + b.d / 2) * T;
      scene.addCustom({ id: `b${b.id}`, pos: { x: cx, y: cy, z: 0 }, radius: (Math.min(b.w, b.d) * T) / 2 - 0.01, draw: (c) => drawBuilding(c, b) });
    }
    for (const e of g.enemies) {
      const prev = lastPos.get(e.id);
      if (prev) {
        const dxs = (e.x - prev.x) + (e.y - prev.y); // 屏幕 x ∝ x + y
        if (Math.abs(dxs) > 1e-3) facing.set(e.id, dxs > 0 ? 1 : -1);
      }
      lastPos.set(e.id, { x: e.x, y: e.y });
      const face = facing.get(e.id) ?? -1;
      scene.addCustom({
        id: `e${e.id}`, pos: { x: e.x, y: e.y, z: 0 }, radius: 0,
        draw: (c, p, ppm) => drawEnemy(c, e.type, p, ppm * 0.1 * ENEMY_SCALE, nightA, face, (clock * e.def.speed * 0.9) % 1, e.hp / e.maxHp, clock),
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
    if (b.burnUntil > g.t) { const f = S((x0 + x1) / 2, (y0 + y1) / 2, 3.2); c.fillStyle = "#f08a2c"; c.globalAlpha = 0.8; c.beginPath(); c.ellipse(f.x, f.y, lw * 5, lw * 8, 0, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1; }
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
    for (let k = fx.length - 1; k >= 0; k--) {
      const f = fx[k]!;
      const age = clock - f.t0;
      if (age > f.life) { fx.splice(k, 1); continue; }
      if (f.kind === "smoke") drawSmoke(c, S(f.x, f.y), u, age, f.life);
      else if (f.kind === "text") drawFloatText(c, S(f.x, f.y, 2.2), f.text!, f.color!, age, f.life, Math.max(11, u * 2.6));
      else drawArrow(c, S(f.fromX!, f.fromY!, 4.6), S(f.x, f.y, 0.8), Math.min(1, age / f.life), u, !!f.fire);
    }
  };

  // ---------------------------------------------------------------- 事件 → 特效 / 提示
  const handleEvents = () => {
    for (const e of drainEvents(g)) {
      if (e.type === "shot") {
        const b = g.buildings.get(e.tower);
        if (b) fx.push({ kind: "arrow", fromX: (b.i + b.w / 2) * T, fromY: (b.j + b.d / 2) * T, x: e.x, y: e.y, t0: clock, life: 0.35 / speed, fire: b.kind === "tower_oil_fire" });
      } else if (e.type === "enemyFled") {
        fx.push({ kind: "smoke", x: e.x, y: e.y, t0: clock, life: 0.9 });
        if (e.reward.coin) fx.push({ kind: "text", x: e.x, y: e.y, t0: clock, life: 1.1, text: `+${e.reward.coin}`, color: "#d9a838" });
        lastPos.delete(e.id); facing.delete(e.id);
      } else if (e.type === "nightStart") toast(e.title);
      else if (e.type === "married") toast("修好青瓦正房，迎娶阿莲！");
      else if (e.type === "birth") toast(`厢房添丁：${e.name}`);
      else if (e.type === "grownUp") toast(`${e.name}长成少年：${cfg.family.roles[e.role]?.name}`);
      else if (e.type === "buildingDestroyed") toast(`${cfg.defense.towers[e.kind]?.name ?? cfg.economy.buildings[e.kind]?.name ?? cfg.defense.walls[e.kind]?.name ?? "建筑"}被毁！`);
      else if (e.type === "dawn") toast(`天亮了 · 收获 ${costText(e.reward)}${e.starved ? " · 口粮不够！" : ""}`);
      else if (e.type === "victory") banner("击退黑风大当家\n深山传家 · 大获全胜");
      else if (e.type === "defeat") banner(`第${NUM[e.night] ?? e.night}夜 · 寨破`);
    }
  };

  // ---------------------------------------------------------------- 主循环
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
    const target = g.phase === "night" ? 1 : g.phase === "day" && g.dayLeft < 5 ? ((5 - g.dayLeft) / 5) * 0.75 : 0;
    nightA += Math.sign(target - nightA) * Math.min(Math.abs(target - nightA), dt * 0.8);
    syncScene();
    const { w, h } = platform.screenSize();
    renderer.render(scene, cam, nightA, { w, h, dpr: platform.pixelRatio() }, { ground, paper, drawDecals, drawOverlay });
    uiT -= dt;
    if (uiT <= 0) { renderTop(); renderBottom(); if (selected !== null) renderPanel(); uiT = 0.25; }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.style.opacity = "0"; }
    platform.requestFrame(frame);
  };
  platform.requestFrame(frame);
}

boot().catch((e) => {
  document.body.innerHTML = `<pre style="color:#ffb4a8;padding:12px;white-space:pre-wrap">启动失败：${e instanceof Error ? e.stack : String(e)}</pre>`;
  console.error(e);
});
