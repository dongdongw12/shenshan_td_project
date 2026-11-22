/**
 * 浏览器开发台：加载 /dev/sprites.json 的替身精灵，摆一个小山村，验证
 *   - 2:1 等距对齐（锚点落在格子中心）
 *   - 地影单独一层
 *   - 移动单位绕多格建筑走时的遮挡排序
 *   - 昼夜交叉淡入 + 逐户点灯
 * 操作：拖动平移、滚轮缩放、滑块拖时辰、勾选“占地框”看排序用的占地矩形。
 */
import { BrowserPlatform } from "../platform/browser";
import { DayNightClock, type Phase } from "../render/dayNight";
import { IsoProjection, type Vec2 } from "../render/iso";
import { IsoRenderer, type Camera, type SpriteImages } from "../render/renderer";
import { Scene } from "../render/scene";
import { validateAtlas, type SpriteAtlasIndex } from "../render/spriteMeta";
import { drawVillager, walkLoop } from "./villager";
import { paintGround, paintPaper, parseGroundMap } from "../render/groundPainter";

// j = 0 是离相机最近的一排（屏幕左下边），i 向屏幕右下。g 草 d 土路 f 水田 w 溪 r 山石
const VILLAGE = parseGroundMap([
  "ggggfffggg",
  "ggggfffggr",
  "dddddddddd",
  "ggggggdggw",
  "ggggggdgww",
  "fffgggggwg",
  "fffggggwwg",
  "fffgggwwgg",
  "ggggggwggr",
]);

const PHASE_ZH: Record<Phase, string> = { day: "白昼", dusk: "黄昏 · 点灯", night: "夜晚", dawn: "黎明 · 熄灯" };

async function boot(): Promise<void> {
  const canvas = document.getElementById("stage") as HTMLCanvasElement;
  const platform = new BrowserPlatform(canvas);
  const atlas = await platform.loadJson<SpriteAtlasIndex>("/dev/sprites.json");
  const problems = validateAtlas(atlas);
  if (problems.length) console.warn("sprites.json 校验：", problems);

  const images = new Map<string, SpriteImages>();
  await Promise.all(
    Object.entries(atlas.sprites).map(async ([stem, m]) => {
      const [day, night, shadow] = await Promise.all([
        platform.loadImage(`/dev/${m.day_file}`),
        platform.loadImage(`/dev/${m.night_file}`),
        m.shadow_file ? platform.loadImage(`/dev/${m.shadow_file}`) : Promise.resolve(undefined),
      ]);
      images.set(stem, { day, night, shadow });
    }),
  );

  const iso = new IsoProjection({ pxPerMeter: atlas.px_per_meter, tileSize: 2, elevationDeg: 30 });
  const scene = new Scene(VILLAGE.cols, VILLAGE.rows, atlas);
  const has = (s: string) => s in atlas.sprites;
  if (has("house_lv2_tile")) { scene.addSprite("house_lv2_tile", 2, 3); scene.addSprite("house_lv2_tile", 6, 5); }
  if (has("tower_bamboo")) { scene.addSprite("tower_bamboo", 1, 1); scene.addSprite("tower_bamboo", 8, 1); scene.addSprite("tower_bamboo", 5, 8); }
  if (has("prop_pine_tree")) { for (const [i, j] of [[0, 8], [4, 0], [9, 7], [5, 4], [0, 0], [3, 7]]) scene.addSprite("prop_pine_tree", i!, j!); }

  const t0 = performance.now();
  const off = (w: number, h: number) => platform.createOffscreen(w, h);
  const ground = { day: paintGround(off, VILLAGE, atlas.px_per_meter, false), night: paintGround(off, VILLAGE, atlas.px_per_meter, true) };
  const paper = paintPaper(off);
  const groundMs = performance.now() - t0;

  // 村民绕第一栋房子（占地 x∈[4,8]、y∈[6,10]）走一圈
  const loop: Vec2[] = [{ x: 3.3, y: 5.3 }, { x: 8.7, y: 5.3 }, { x: 8.7, y: 10.7 }, { x: 3.3, y: 10.7 }];
  let walked = 0;
  const villager = scene.addCustom({
    id: "villager", pos: { ...loop[0]!, z: 0 }, radius: 0,
    draw: (ctx, p, ppm, a) => drawVillager(ctx, p, ppm, a, walked / 0.9),
  });

  const ctx = canvas.getContext("2d")!;
  const renderer = new IsoRenderer(ctx, iso, images);
  const clock = new DayNightClock({ dayS: 20, duskS: 6, nightS: 16, dawnS: 5 });
  clock.t = 14;

  // 相机：把地图中心放到屏幕中心，缩放到刚好装下
  const cam: Camera = { x: 0, y: 0, zoom: 1 };
  const fit = () => {
    const { w, h } = platform.screenSize();
    const corners = [iso.worldToScreen({ x: 0, y: 0 }), iso.worldToScreen({ x: 20, y: 0 }), iso.worldToScreen({ x: 0, y: 18 }), iso.worldToScreen({ x: 20, y: 18 })];
    const minX = Math.min(...corners.map((c) => c.x)), maxX = Math.max(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y)) - 6 * iso.kz, maxY = Math.max(...corners.map((c) => c.y));
    cam.zoom = Math.min(w / (maxX - minX), (h - 70) / (maxY - minY)) * 0.95;
    cam.x = w / 2 - ((minX + maxX) / 2) * cam.zoom;
    cam.y = (h - 70) / 2 - ((minY + maxY) / 2) * cam.zoom;
  };

  const resize = () => {
    const dpr = platform.pixelRatio();
    const { w, h } = platform.screenSize();
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    fit();
  };
  window.addEventListener("resize", resize);
  resize();

  // 交互
  let drag: { x: number; y: number } | null = null;
  let hover: Vec2 | null = null;
  canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing"; });
  canvas.addEventListener("pointerup", () => { drag = null; canvas.style.cursor = "grab"; });
  canvas.addEventListener("pointermove", (e) => {
    if (drag) { cam.x += e.clientX - drag.x; cam.y += e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; }
    hover = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.0015);
    cam.x = e.clientX - (e.clientX - cam.x) * k;
    cam.y = e.clientY - (e.clientY - cam.y) * k;
    cam.zoom *= k;
  }, { passive: false });

  const timeInput = document.getElementById("time") as HTMLInputElement;
  const playBtn = document.getElementById("play") as HTMLButtonElement;
  const speedSel = document.getElementById("speed") as HTMLSelectElement;
  const debugBox = document.getElementById("debug") as HTMLInputElement;
  const phaseEl = document.getElementById("phase")!;
  const statsEl = document.getElementById("stats")!;
  let playing = true;
  playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? "暂停" : "播放"; };
  timeInput.oninput = () => { clock.t = (Number(timeInput.value) / 1000) * clock.period; };
  // 方便自动化截图：?t=秒 固定时辰并暂停，?debug=1 打开占地框
  const qs = new URLSearchParams(location.search);
  if (qs.has("t")) { clock.t = Number(qs.get("t")); playing = false; playBtn.textContent = "播放"; }
  if (qs.get("debug") === "1") debugBox.checked = true;
  // ?walk=米 把村民固定在绕房路线上的某处（检查遮挡用）；?zoom= 与 ?focus=i,j 放大到某格
  const fixedWalk = qs.has("walk") ? Number(qs.get("walk")) : null;
  if (qs.has("zoom")) {
    const z = Number(qs.get("zoom"));
    const [fi, fj] = (qs.get("focus") ?? "4,4").split(",").map(Number);
    const c = iso.worldToScreen(iso.tileCenter(fi ?? 4, fj ?? 4));
    const { w, h } = platform.screenSize();
    cam.zoom = z; cam.x = w / 2 - c.x * z; cam.y = (h - 70) / 2 - c.y * z;
  }

  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, fps = 0, renderMs = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) { clock.speed = Number(speedSel.value); clock.update(dt); }
    walked = fixedWalk ?? walked + dt * 1.1;
    const p = walkLoop(loop, walked);
    villager.pos = { x: p.x, y: p.y, z: 0 };

    const { w, h } = platform.screenSize();
    const a = clock.nightAlpha();
    const r0 = performance.now();
    const flat = qs.get("ground") === "flat";
    const stats = renderer.render(scene, cam, a, { w, h, dpr: platform.pixelRatio() },
      flat ? {} : { ground, paper: qs.get("paper") === "0" ? undefined : paper, showGrid: debugBox.checked });
    renderMs = renderMs * 0.9 + (performance.now() - r0) * 0.1;

    if (hover && !drag) {
      const t = iso.screenToTile({ x: (hover.x - cam.x) / cam.zoom, y: (hover.y - cam.y) / cam.zoom });
      if (t.i >= 0 && t.j >= 0 && t.i < scene.cols && t.j < scene.rows) {
        const pts = iso.tileCorners(t.i, t.j).map((q) => ({ x: cam.x + q.x * cam.zoom, y: cam.y + q.y * cam.zoom }));
        ctx.strokeStyle = "rgba(255,226,150,0.9)"; ctx.lineWidth = 2;
        ctx.beginPath(); pts.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke();
      }
    }
    if (debugBox.checked) {
      ctx.lineWidth = 1.5;
      for (const s of scene.sortables()) {
        const c = [iso.worldToScreen({ x: s.x0, y: s.y0 }), iso.worldToScreen({ x: s.x0, y: s.y1 }), iso.worldToScreen({ x: s.x1, y: s.y1 }), iso.worldToScreen({ x: s.x1, y: s.y0 })]
          .map((q) => ({ x: cam.x + q.x * cam.zoom, y: cam.y + q.y * cam.zoom }));
        ctx.strokeStyle = s.obj.kind === "custom" ? "#ff5a3c" : "rgba(80,220,255,0.9)";
        ctx.beginPath(); c.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke();
      }
    }

    phaseEl.textContent = PHASE_ZH[clock.phase()];
    if (document.activeElement !== timeInput) timeInput.value = String(Math.round((clock.t / clock.period) * 1000));
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    statsEl.textContent = `${fps.toFixed(0)} fps · 每帧绘制 ${renderMs.toFixed(2)}ms（排序 ${stats.sortMs.toFixed(2)}ms）· ${stats.drawn} 个物体 · 地面贴图 ${ground.day.canvas.width}×${ground.day.canvas.height}（生成 ${groundMs.toFixed(0)}ms）· 缩放 ${cam.zoom.toFixed(2)}`;
    platform.requestFrame(frame);
  };
  platform.requestFrame(frame);
}

boot().catch((e) => {
  document.getElementById("err")!.textContent = `启动失败：${e instanceof Error ? e.stack ?? e.message : String(e)}`;
  console.error(e);
});
