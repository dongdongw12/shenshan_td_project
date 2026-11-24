"""
从开发台资源（client/assets/dev，128 px/m）生成手机版资源（client/assets/mobile），给微信小游戏打包用。

为什么：小游戏分包合计限 30MB，手机解码后的显存更紧。开发版全套 PNG 24MB、解码后约 390MB（角色表 260MB，
而角色序列帧每帧四周大半是透明边）。这里做两件事，画面上看不出差别：
1. 裁透明边：建筑精灵按 day / night / shadow 三张的并集裁；角色按“该角色所有动作、朝向、昼夜、所有帧”的并集裁
   （同一角色所有帧共用一个 frame_size 和锚点，客户端代码不用改）；
2. 统一缩到 --scale（默认 0.75 → 96 px/m）。小游戏按 2 倍屏画，默认缩放下每米约 72 物理像素，96 留了放大余量。

用法（Blender 自带 Python，有 numpy + OpenImageIO）：
  $PY -I pipeline/atlas/make_mobile.py --src client/assets/dev --out client/assets/mobile --scale 0.75
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "style"))
sys.path.insert(0, str(ROOT / "atlas"))
import stylize_sprites as st  # noqa: E402
from compose_preview import read_png  # noqa: E402
from export_sprites import resize_premultiplied  # noqa: E402

ALPHA_EPS = 2.0 / 255
PAD = 2


def bbox(alpha):
    ys, xs = np.nonzero(alpha > ALPHA_EPS)
    if not len(xs):
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


def union(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def padded(box, w, h):
    return [max(0, box[0] - PAD), max(0, box[1] - PAD), min(w, box[2] + PAD), min(h, box[3] + PAD)]


def scaled_size(w, h, s):
    return max(1, round(w * s)), max(1, round(h * s))


def do_sprites(src, out, s):
    index = json.load(open(src / "sprites.json", encoding="utf-8"))
    new = {k: v for k, v in index.items() if k != "sprites"}
    new["px_per_meter"] = round(index["px_per_meter"] * s, 4)
    new["scale"] = round(index.get("scale", 1.0) * s, 4)
    new["mobile"] = {"from": "dev", "scale": s, "trimmed": True}
    new["sprites"] = {}
    before = after = 0
    for stem, m in index["sprites"].items():
        keys = [k for k in ("day_file", "night_file", "shadow_file") if m.get(k)]
        imgs = {k: read_png(src / m[k]) for k in keys}
        h0, w0 = next(iter(imgs.values())).shape[:2]
        box = None
        for img in imgs.values():
            box = union(box, bbox(img[..., 3]))
        box = padded(box or [0, 0, w0, h0], w0, h0)
        cw, ch = box[2] - box[0], box[3] - box[1]
        w, h = scaled_size(cw, ch, s)
        for k, img in imgs.items():
            st.write_png(out / m[k], resize_premultiplied(img[box[1]:box[3], box[0]:box[2]], w, h))
        mm = dict(m)
        mm["resolution"] = [w, h]
        ax, ay = (m["anchor_px"][0] - box[0]) * w / cw, (m["anchor_px"][1] - box[1]) * h / ch
        mm["anchor_px"] = [round(ax, 2), round(ay, 2)]
        mm["anchor_uv"] = [round(ax / w, 5), round(ay / h, 5)]
        mm["px_per_meter"] = new["px_per_meter"]
        if "tile_px" in m:
            mm["tile_px"] = [round(v * s, 2) for v in m["tile_px"]]
        mm["mobile_crop"] = box
        new["sprites"][stem] = mm
        before += w0 * h0 * len(keys)
        after += w * h * len(keys)
        print(f"SPRITE {stem} {w0}x{h0} -> crop {cw}x{ch} -> {w}x{h}", flush=True)
    json.dump(new, open(out / "sprites.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return before, after


def do_chars(src, out, s):
    index = json.load(open(src / "chars/chars.json", encoding="utf-8"))
    (out / "chars").mkdir(parents=True, exist_ok=True)
    new = {k: v for k, v in index.items() if k != "chars"}
    new["px_per_meter"] = round(index["px_per_meter"] * s, 4)
    new["chars"] = {}
    before = after = 0
    for cid, m in index["chars"].items():
        fw, fh = m["frame_size"]
        sheets = {}  # 文件名 → 帧数
        for d in m["dirs"].values():
            for f in d.values():
                sheets[f] = m["frames"]
        for a in (m.get("actions") or {}).values():
            for d in a["dirs"].values():
                for f in d.values():
                    sheets[f] = a["frames"]
        imgs = {f: read_png(src / "chars" / f) for f in sheets}
        box = None
        for f, img in imgs.items():
            for k in range(sheets[f]):
                box = union(box, bbox(img[:, k * fw:(k + 1) * fw, 3]))
        box = padded(box or [0, 0, fw, fh], fw, fh)
        cw, ch = box[2] - box[0], box[3] - box[1]
        w, h = scaled_size(cw, ch, s)
        for f, img in imgs.items():
            n = sheets[f]
            sheet = np.zeros((h, w * n, 4), np.float32)
            for k in range(n):
                frame = img[box[1]:box[3], k * fw + box[0]:k * fw + box[2]]
                sheet[:, k * w:(k + 1) * w] = resize_premultiplied(frame, w, h)
            st.write_png(out / "chars" / f, sheet)
            before += fw * fh * n
            after += w * h * n
        mm = dict(m)
        mm["frame_size"] = [w, h]
        mm["anchor_px"] = [round((m["anchor_px"][0] - box[0]) * w / cw, 2), round((m["anchor_px"][1] - box[1]) * h / ch, 2)]
        mm["px_per_meter"] = new["px_per_meter"]
        mm["mobile_crop"] = box
        new["chars"][cid] = mm
        print(f"CHAR {cid} frame {fw}x{fh} -> crop {cw}x{ch} -> {w}x{h} ({len(sheets)} sheets)", flush=True)
    json.dump(new, open(out / "chars/chars.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return before, after


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--src", default="client/assets/dev")
    p.add_argument("--out", default="client/assets/mobile")
    p.add_argument("--scale", type=float, default=0.75)
    args = p.parse_args()
    src, out = Path(args.src), Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    sb, sa = do_sprites(src, out, args.scale)
    cb, ca = do_chars(src, out, args.scale)
    mb = lambda px: px * 4 / 1e6  # noqa: E731
    size = lambda d: sum(f.stat().st_size for f in d.rglob("*.png")) / 1e6  # noqa: E731
    print(f"\n解码后显存：建筑 {mb(sb):.0f}→{mb(sa):.0f}MB，角色 {mb(cb):.0f}→{mb(ca):.0f}MB")
    print(f"PNG 文件：{size(src):.1f}MB → {size(out):.1f}MB")


if __name__ == "__main__":
    main()
