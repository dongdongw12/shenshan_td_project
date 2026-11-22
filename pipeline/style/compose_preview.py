"""
场景预览：按 _meta.json 的锚点与比例，把精灵摆到 2:1 等距地块网格上，白昼 / 夜晚各出一张。
用途：美术验收（像游戏里那样看整体画风、墨线粗细是否一致）+ 检查锚点 / 比例是否对齐格子。

用法（Blender 自带 Python 或装了 numpy + Pillow 的 Python）：
  python3 pipeline/style/compose_preview.py --sprites pipeline/baked_sprites --out preview \
      --place house_lv2_tile:1,1 --place tower_bamboo:4,3 --place prop_pine_tree:4,0 [--grid 7x6]
--place <stem>:<i>,<j>：资产占地左下角所在格（i 沿世界 +X / 屏幕右下，j 沿世界 +Y / 屏幕右上）。
"""

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stylize_sprites as st  # noqa: E402


def read_png(path):
    if st.oiio is not None:
        inp = st.oiio.ImageInput.open(str(path))
        spec = inp.spec()
        a = np.asarray(inp.read_image(0, 0, 0, spec.nchannels, st.oiio.FLOAT)).reshape(spec.height, spec.width, spec.nchannels)
        inp.close()
    else:
        from PIL import Image
        a = np.asarray(Image.open(path).convert("RGBA"), dtype=np.float32) / 255.0
    if a.shape[2] == 3:
        a = np.concatenate([a, np.ones_like(a[..., :1])], -1)
    return a.astype(np.float32)


def parse_fp(fp):
    a, b = (int(float(x)) for x in str(fp).lower().split("x"))
    return a, b


def compose(sprites_dir, places, grid, which, ppm, tile_m, elevation):
    hw = math.sqrt(2) / 2 * tile_m * ppm            # 半个菱形宽（像素）
    hh = hw * math.sin(math.radians(elevation))      # 半个菱形高
    def to_screen(wx, wy):                            # 世界米 → 屏幕像素（y 向下），原点 = 网格 (0,0) 角
        return (wx + wy) / tile_m * hw, (wx - wy) / tile_m * hh

    gx, gy = grid
    corners = [to_screen(x * tile_m, y * tile_m) for x in (0, gx) for y in (0, gy)]
    items = []
    for stem, (i, j) in places:
        meta = json.load(open(Path(sprites_dir) / f"{stem}_meta.json", encoding="utf-8"))
        img = read_png(Path(sprites_dir) / meta[f"{which}_file"])
        shadow = read_png(Path(sprites_dir) / meta["shadow_file"]) if meta.get("shadow_file") else None
        if shadow is not None and which == "night":
            shadow[..., 3] *= float(meta.get("night_shadow_opacity", 0.6))
        fa, fb = parse_fp(meta.get("footprint", "1x1"))
        cx, cy = to_screen((i + fa / 2) * tile_m, (j + fb / 2) * tile_m)
        ax, ay = meta["anchor_px"]
        x0, y0 = cx - ax, cy - ay
        items.append((cy, x0, y0, img, shadow))
        corners += [(x0, y0), (x0 + img.shape[1], y0 + img.shape[0])]

    pad = 40
    minx = min(c[0] for c in corners) - pad
    miny = min(c[1] for c in corners) - pad
    W = int(math.ceil(max(c[0] for c in corners) - minx + pad))
    H = int(math.ceil(max(c[1] for c in corners) - miny + pad))

    # 地面：两色交替的菱形地块 + 细格线
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    sx, sy = xx + minx, yy + miny
    u = (sx / hw + sy / hh) / 2       # = wx / tile
    v = (sx / hw - sy / hh) / 2       # = wy / tile
    inside = (u >= 0) & (u < gx) & (v >= 0) & (v < gy)
    checker = ((np.floor(u) + np.floor(v)) % 2).astype(np.float32)
    if which == "day":
        bg = np.array([0.80, 0.83, 0.78]); ground = [np.array([0.62, 0.66, 0.48]), np.array([0.58, 0.62, 0.45])]
        line = np.array([0.45, 0.48, 0.36])
    else:
        bg = np.array([0.06, 0.08, 0.15]); ground = [np.array([0.14, 0.17, 0.26]), np.array([0.12, 0.15, 0.24])]
        line = np.array([0.09, 0.11, 0.19])
    canvas = np.broadcast_to(bg, (H, W, 3)).copy()
    g = ground[0] * (1 - checker[..., None]) + ground[1] * checker[..., None]
    canvas = np.where(inside[..., None], g, canvas)
    edge = inside & ((np.abs(u - np.round(u)) * hw < 1.2) | (np.abs(v - np.round(v)) * hw < 1.2))
    canvas = np.where(edge[..., None], line, canvas)

    def blit(img, x0, y0):
        X, Y = int(round(x0 - minx)), int(round(y0 - miny))
        h, w = img.shape[:2]
        sub = canvas[Y:Y + h, X:X + w]
        a = img[: sub.shape[0], : sub.shape[1], 3:4]
        sub[:] = img[: sub.shape[0], : sub.shape[1], :3] * a + sub * (1 - a)

    # 地面层：先画全部地影；物体层：由远到近（锚点屏幕 y 小 → 大）叠放
    for _, x0, y0, _, shadow in items:
        if shadow is not None:
            blit(shadow, x0, y0)
    for _, x0, y0, img, _ in sorted(items, key=lambda t: t[0]):
        blit(img, x0, y0)
    return canvas


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sprites", required=True)
    p.add_argument("--out", required=True, help="输出前缀，生成 <out>_day.png / <out>_night.png")
    p.add_argument("--place", action="append", required=True)
    p.add_argument("--grid", default="7x6")
    args = p.parse_args()
    places = []
    for spec in args.place:
        stem, ij = spec.split(":")
        i, j = (int(x) for x in ij.split(","))
        places.append((stem, (i, j)))
    first = json.load(open(Path(args.sprites) / f"{places[0][0]}_meta.json", encoding="utf-8"))
    ppm, tile_m, elev = first["px_per_meter"], first["tile_size_m"], first["camera_elevation_deg"]
    for stem, _ in places:
        m = json.load(open(Path(args.sprites) / f"{stem}_meta.json", encoding="utf-8"))
        if abs(m["px_per_meter"] - ppm) > 1e-6:
            print(f"WARN {stem} px_per_meter={m['px_per_meter']} 与 {ppm} 不一致，场景里比例会错", flush=True)
    grid = tuple(int(x) for x in args.grid.lower().split("x"))
    for which in ("day", "night"):
        img = compose(args.sprites, places, grid, which, ppm, tile_m, elev)
        out = f"{args.out}_{which}.png"
        st.write_png(out, np.concatenate([img, np.ones_like(img[..., :1])], -1))
        print("PREVIEW", out, img.shape[1], "x", img.shape[0], flush=True)


if __name__ == "__main__":
    main()
