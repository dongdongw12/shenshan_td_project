"""
角色序列帧导出：把 bake_sprite_anim.py 的输出（<id>_anim.json + 精灵表 PNG）合并进客户端的 chars.json。

  python3 pipeline/atlas/export_chars.py --anims /path/to/bake_out --out client/assets/dev/chars
  python3 pipeline/atlas/export_chars.py --anims /path/to/bake_out --out client/assets/dev/chars --only hero,wife

只增改烘过的角色，chars.json 里其他角色保持不动；同一个 chars.json 里所有角色必须是同一 px_per_meter。
不依赖 Blender / PIL，纯标准库。
"""

import argparse
import json
import shutil
import sys
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--anims", required=True, help="bake_sprite_anim.py 的 --out 目录")
    p.add_argument("--out", required=True, help="客户端角色目录（含 chars.json）")
    p.add_argument("--only", default="", help="逗号分隔，只导出这些角色")
    a = p.parse_args()
    src, out = Path(a.anims).expanduser().resolve(), Path(a.out).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    only = {x for x in a.only.split(",") if x}

    index_path = out / "chars.json"
    index = json.loads(index_path.read_text("utf-8")) if index_path.exists() else {"px_per_meter": None, "chars": {}}
    n = 0
    for meta_path in sorted(src.glob("*_anim.json")):
        meta = json.loads(meta_path.read_text("utf-8"))
        cid = meta["id"]
        if only and cid not in only:
            continue
        ppm = meta["px_per_meter"]
        if index["px_per_meter"] not in (None, ppm):
            sys.exit(f"{cid}: px_per_meter {ppm} 与 chars.json 的 {index['px_per_meter']} 不一致（先统一烘培比例）")
        index["px_per_meter"] = ppm
        files = set()
        for act in (meta.get("actions") or {"walk": {"dirs": meta["dirs"]}}).values():
            for d in act["dirs"].values():
                files.update(d.values())
        for f in sorted(files):
            shutil.copy2(src / f, out / f)
        index["chars"][cid] = meta
        n += 1
        print(f"EXPORTED {cid} actions={list((meta.get('actions') or {}).keys())} files={len(files)}")
    index["chars"] = dict(sorted(index["chars"].items()))
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), "utf-8")
    print(f"INDEX {index_path} ({len(index['chars'])} chars, {n} updated)")


if __name__ == "__main__":
    main()
