/**
 * 精灵图鉴（开发台）：把 sprites.json 里的每张建筑 / 道具精灵和 chars.json 里的每个角色摆成卡片，
 * 统一比例、可调入夜程度、显示占地框与锚点，用来验收烘培结果（替身、以后的 AI 资产都一样）。
 * 打开：npm --prefix client run dev → http://127.0.0.1:5173/gallery.html
 */
import { drawAnimFrame, type AnimImages, type AnimIndex } from "../render/animSprites";
import { parseFootprint, type SpriteAtlasIndex } from "../render/spriteMeta";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const loadImage = (src: string) => new Promise<HTMLImageElement>((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error(src)); im.src = src; });
const BG: Record<string, string> = { grass: "#9fbf8a", paper: "#efe6d2", dark: "#1a2550" };

interface SpriteCard { stem: string; canvas: HTMLCanvasElement; day: HTMLImageElement; night: HTMLImageElement; shadow?: HTMLImageElement }
interface CharCard { id: string; canvas: HTMLCanvasElement; meta: AnimIndex["chars"][string]; img: AnimImages; note: HTMLElement }

async function main(): Promise<void> {
  const atlas = await (await fetch("/dev/sprites.json")).json() as SpriteAtlasIndex;
  const sprites: SpriteCard[] = [];
  for (const [stem, m] of Object.entries(atlas.sprites)) {
    const [day, night, shadow] = await Promise.all([
      loadImage(`/dev/${m.day_file}`), loadImage(`/dev/${m.night_file}`),
      m.shadow_file ? loadImage(`/dev/${m.shadow_file}`).catch(() => undefined) : Promise.resolve(undefined),
    ]);
    const card = document.createElement("div");
    card.className = "card";
    const canvas = document.createElement("canvas");
    card.appendChild(canvas);
    const fp = parseFootprint(m.footprint);
    const info = [`${m.footprint} 格`, m.actual_height_m ? `高 ${m.actual_height_m.toFixed(2)}m` : "", `${m.resolution[0]}×${m.resolution[1]}px`, `${m.px_per_meter}px/m`].filter(Boolean).join(" · ");
    card.insertAdjacentHTML("beforeend", `<div class="name">${m.name && m.name !== stem ? `${m.name}<br>` : ""}${stem}</div><div class="meta">${info}</div>`);
    const [ax, ay] = m.anchor_px;
    if (ax < 0 || ay < 0 || ax > m.resolution[0] || ay > m.resolution[1]) card.insertAdjacentHTML("beforeend", `<div class="warn">锚点不在图内</div>`);
    if (fp.w * fp.d === 0) card.insertAdjacentHTML("beforeend", `<div class="warn">占地格式不对</div>`);
    $("sprites").appendChild(card);
    sprites.push({ stem, canvas, day, night, shadow });
  }

  const chars: CharCard[] = [];
  try {
    const index = await (await fetch("/dev/chars/chars.json")).json() as AnimIndex;
    for (const [id, m] of Object.entries(index.chars)) {
      const L = (f: string) => loadImage(`/dev/chars/${f}`);
      const img: AnimImages = {
        front: { day: await L(m.dirs.front.day), night: await L(m.dirs.front.night) },
        back: { day: await L(m.dirs.back.day), night: await L(m.dirs.back.night) },
        actions: {},
      };
      for (const [act, a] of Object.entries(m.actions ?? {})) {
        if (act === "walk") continue;
        img.actions![act] = { front: { day: await L(a.dirs.front.day), night: await L(a.dirs.front.night) }, back: { day: await L(a.dirs.back.day), night: await L(a.dirs.back.night) } };
      }
      const card = document.createElement("div");
      card.className = "card";
      const canvas = document.createElement("canvas");
      card.appendChild(canvas);
      const acts = Object.keys(m.actions ?? { walk: 1 });
      card.insertAdjacentHTML("beforeend", `<div class="name">${id}</div><div class="meta">${m.frame_size[0]}×${m.frame_size[1]}px · ${acts.join(" / ")}</div>`);
      const note = document.createElement("div");
      note.className = "meta";
      card.appendChild(note);
      $("chars").appendChild(card);
      chars.push({ id, canvas, meta: m, img, note });
    }
  } catch { /* 没有角色数据也能看建筑 */ }

  $("stat").textContent = `${sprites.length} 张建筑 / 道具 · ${chars.length} 个角色`;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const drawSprites = () => {
    const night = Number($<HTMLInputElement>("night").value), zoom = Number($<HTMLInputElement>("zoom").value);
    const bg = BG[$<HTMLSelectElement>("bg").value]!, showFp = $<HTMLInputElement>("fp").checked, showShadow = $<HTMLInputElement>("shadow").checked;
    for (const s of sprites) {
      const m = atlas.sprites[s.stem]!;
      const k = zoom * (64 / m.px_per_meter);
      const w = Math.ceil(m.resolution[0] * k), h = Math.ceil(m.resolution[1] * k);
      s.canvas.width = w * dpr; s.canvas.height = h * dpr;
      s.canvas.style.width = `${w}px`; s.canvas.style.height = `${h}px`;
      const c = s.canvas.getContext("2d")!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = mix(bg, "#1a2550", night);
      c.fillRect(0, 0, w, h);
      const [ax, ay] = m.anchor_px;
      if (showFp) {
        // 占地框：世界 X 往屏幕右下、世界 Y 往右上（正面 −Y 朝左下）
        const fp = parseFootprint(m.footprint);
        const tw = m.tile_px?.[0] ?? 181, th = m.tile_px?.[1] ?? 90.5;
        const pt = (a: number, b: number) => [(ax + (a + b) * tw / 2) * k, (ay + (a - b) * th / 2) * k] as const;
        c.beginPath();
        const corners = [pt(-fp.w / 2, -fp.d / 2), pt(fp.w / 2, -fp.d / 2), pt(fp.w / 2, fp.d / 2), pt(-fp.w / 2, fp.d / 2)];
        corners.forEach(([x, y], n) => (n ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.closePath();
        c.fillStyle = "rgba(28,21,16,0.08)"; c.fill();
        c.setLineDash([4, 3]); c.strokeStyle = "rgba(184,53,42,0.8)"; c.lineWidth = 1; c.stroke(); c.setLineDash([]);
      }
      if (showShadow && s.shadow) { c.globalAlpha = 1 - 0.4 * night; c.drawImage(s.shadow, 0, 0, w, h); c.globalAlpha = 1; }
      c.drawImage(s.day, 0, 0, w, h);
      if (night > 0.002) { c.globalAlpha = night; c.drawImage(s.night, 0, 0, w, h); c.globalAlpha = 1; }
      if (showFp) { c.fillStyle = "#b8352a"; c.beginPath(); c.arc(ax * k, ay * k, 2.5, 0, Math.PI * 2); c.fill(); }
    }
  };

  const drawChars = (t: number) => {
    const night = Number($<HTMLInputElement>("night").value), zoom = Number($<HTMLInputElement>("zoom").value) * 1.6;
    const bg = BG[$<HTMLSelectElement>("bg").value]!, action = $<HTMLSelectElement>("action").value;
    const dirSel = $<HTMLSelectElement>("dir").value;
    const dir = dirSel.startsWith("front") ? "front" : "back", flip = dirSel.endsWith("R");
    for (const ch of chars) {
      const [fw, fh] = ch.meta.frame_size;
      const w = Math.ceil(fw * zoom), h = Math.ceil(fh * zoom);
      if (ch.canvas.width !== w * dpr || ch.canvas.height !== h * dpr) {
        ch.canvas.width = w * dpr; ch.canvas.height = h * dpr; ch.canvas.style.width = `${w}px`; ch.canvas.style.height = `${h}px`;
      }
      const c = ch.canvas.getContext("2d")!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = mix(bg, "#1a2550", night);
      c.fillRect(0, 0, w, h);
      const has = action === "walk" || !!ch.meta.actions?.[action];
      const act = has ? action : "walk";
      ch.note.textContent = has ? "" : `（没有 ${action}，显示行走）`;
      const [ax, ay] = ch.meta.anchor_px;
      c.globalAlpha = 0.3; c.fillStyle = "#1f2740";
      c.beginPath(); c.ellipse(ax * zoom, ay * zoom, 0.35 * ch.meta.px_per_meter * zoom, 0.14 * ch.meta.px_per_meter * zoom, 0, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
      drawAnimFrame(c, ch.meta, ch.img, { x: ax * zoom, y: ay * zoom }, ch.meta.px_per_meter * zoom, 1, dir, flip, t, night, act);
    }
  };

  for (const id of ["night", "zoom", "bg", "fp", "shadow"]) $(id).addEventListener("input", drawSprites);
  drawSprites();
  const loop = (now: number) => { drawChars(now / 1000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

/** 两个 #rrggbb 按 t 混合 */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i]! - v) * t * 0.85)).join(",")})`;
}

main().catch((e) => { document.body.insertAdjacentHTML("beforeend", `<pre style="color:#b8352a;padding:16px">${String(e)}</pre>`); });
