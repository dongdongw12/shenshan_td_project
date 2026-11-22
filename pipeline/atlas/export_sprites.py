"""
把烘培母版精灵（128 px/m）按统一倍率导出给客户端：缩放 day/night/shadow 三张图、同比换算锚点与比例，
汇总成一个 sprites.json（客户端 SpriteAtlasIndex）。打真正的图集（TexturePacker / Cocos 自动图集）在此之后做。

运行环境：Blender 自带 Python（numpy + OpenImageIO），或装了 numpy + Pillow 的 Python。
用法：
  python3 pipeline/atlas/export_sprites.py --sprites pipeline/baked_sprites --out client/assets/dev --scale 0.5
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "style"))
import stylize_sprites as st  # noqa: E402
from compose_preview import read_png  # noqa: E402


def resize_premultiplied(rgba, w, h):
    a = rgba[..., 3:4]
    pre = np.concatenate([rgba[..., :3] * a, a], axis=-1)
    small = st.resize(pre, w, h)
    sa = np.clip(small[..., 3:4], 0, 1)
    rgb = np.where(sa > 1e-4, np.clip(small[..., :3] / np.maximum(sa, 1e-5), 0, 1), 0)
    return np.concatenate([rgb, sa], axis=-1)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sprites", required=True, help="烘培输出目录（含 *_meta.json）")
    p.add_argument("--out", required=True)
    p.add_argument("--scale", type=float, default=0.5)
    p.add_argument("--only", default="", help="逗号分隔 stem")
    args = p.parse_args()
    src, out = Path(args.sprites), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    only = {s for s in args.only.split(",") if s}

    index = {"scale": args.scale, "px_per_meter": None, "sprites": {}}
    for meta_path in sorted(src.glob("*_meta.json")):
        stem = meta_path.name[: -len("_meta.json")]
        if only and stem not in only:
            continue
        meta = json.load(open(meta_path, encoding="utf-8"))
        if meta.get("mode") == "classic":
            print(f"SKIP {stem}: classic 模式（比例不统一），不导出", flush=True)
            continue
        w0, h0 = meta["resolution"]
        w, h = max(1, round(w0 * args.scale)), max(1, round(h0 * args.scale))
        sx, sy = w / w0, h / h0
        files = {}
        for key in ("day_file", "night_file", "shadow_file"):
            if not meta.get(key):
                continue
            img = read_png(src / meta[key])
            st.write_png(out / meta[key], resize_premultiplied(img, w, h))
            files[key] = meta[key]
        m = dict(meta)
        m.update(files)
        m["resolution"] = [w, h]
        m["anchor_px"] = [round(meta["anchor_px"][0] * sx, 2), round(meta["anchor_px"][1] * sy, 2)]
        m["px_per_meter"] = round(meta["px_per_meter"] * args.scale, 4)
        if "tile_px" in meta:
            m["tile_px"] = [round(v * args.scale, 2) for v in meta["tile_px"]]
        m["export_scale"] = args.scale
        index["sprites"][stem] = m
        if index["px_per_meter"] is None:
            index["px_per_meter"] = m["px_per_meter"]
        elif abs(index["px_per_meter"] - m["px_per_meter"]) > 1e-3:
            print(f"WARN {stem}: px_per_meter {m['px_per_meter']} 与其他精灵不一致", flush=True)
        print(f"EXPORTED {stem} {w0}x{h0} -> {w}x{h}", flush=True)

    with open(out / "sprites.json", "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
    print(f"INDEX {out / 'sprites.json'} ({len(index['sprites'])} sprites)", flush=True)


if __name__ == "__main__":
    main()
