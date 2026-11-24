#!/usr/bin/env python3
"""文档双向同步：仓库 HANDOFF.md + docs/  ⇄  Google 云端硬盘 shenshan_td/docs/（任何电脑都能直接改）。

对应关系：仓库 HANDOFF.md ↔ 云盘 docs/HANDOFF.md；仓库 docs/<路径> ↔ 云盘 docs/<路径>。
样张（docs/art/samples/）不进 Git，只在本地与云盘之间同步。

三方比较（仓库 / 云盘 / 上次同步时的内容，记在云盘 docs/.sync_state.json）：
- 只有一边改了 → 拷到另一边；新文件同理。
- 两边都改了 → 冲突：仓库文件不动，把云盘版存成仓库里的 <名>.drive-conflict-<时间><后缀>，合并后删掉它再同步；
  或用 --prefer repo|drive 一次性按某一边解决。
- 删除默认不传播（只提示）；加 --delete 才删另一边（云盘删的进云盘回收站，仓库删的 git 可恢复）。

用法（每次提交文档前、每次 git pull 之后各跑一次）：
    python3 tools/sync_docs.py            # 同步
    python3 tools/sync_docs.py --dry-run  # 只看会做什么
云盘位置自动找 ~/Library/CloudStorage/GoogleDrive-*/我的云端硬盘|My Drive/shenshan_td；
找不到或有多个时用环境变量 SHENSHAN_DRIVE=<shenshan_td 文件夹路径> 指定。
"""
import argparse
import glob
import hashlib
import json
import os
import shutil
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = ".sync_state.json"
SKIP_NAMES = {".DS_Store", STATE, "desktop.ini", "Thumbs.db"}
SKIP_DIRS = {"__pycache__", "node_modules", ".git"}


def find_drive():
    env = os.environ.get("SHENSHAN_DRIVE")
    if env:
        return env
    pats = [os.path.expanduser("~/Library/CloudStorage/GoogleDrive-*/我的云端硬盘/shenshan_td"),
            os.path.expanduser("~/Library/CloudStorage/GoogleDrive-*/My Drive/shenshan_td"),
            "G:/我的云端硬盘/shenshan_td", "G:/My Drive/shenshan_td"]
    hits = sorted({p for pat in pats for p in glob.glob(pat)})
    if len(hits) == 1:
        return hits[0]
    sys.exit(("找到多个" if hits else "没找到") + " shenshan_td 云盘文件夹" + (f"：{hits}" if hits else "")
             + "；请设置 SHENSHAN_DRIVE=<shenshan_td 路径>")


def skip(name):
    return name in SKIP_NAMES or ".drive-conflict-" in name or name.endswith((".gdoc", ".gsheet", ".gslides"))


def walk(root):
    out = set()
    if not os.path.isdir(root):
        return out
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for f in files:
            if not skip(f):
                out.add(os.path.relpath(os.path.join(d, f), root).replace(os.sep, "/"))
    return out


def repo_path(rel):
    return os.path.join(REPO, "HANDOFF.md") if rel == "HANDOFF.md" else os.path.join(REPO, "docs", rel)


def sha(path):
    if not os.path.isfile(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def copy(src, dst, dry):
    if not dry:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)


def remove(path, dry):
    if not dry:
        os.remove(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--delete", action="store_true", help="把一边的删除同步到另一边")
    ap.add_argument("--prefer", choices=["repo", "drive"], help="两边都改了时以哪边为准")
    args = ap.parse_args()

    drive = os.path.join(find_drive(), "docs")
    state_path = os.path.join(drive, STATE)
    state = json.load(open(state_path, encoding="utf-8")) if os.path.isfile(state_path) else {}
    rels = walk(os.path.join(REPO, "docs")) | walk(drive) | set(state)
    if os.path.isfile(repo_path("HANDOFF.md")):
        rels.add("HANDOFF.md")

    log = {"→ 云盘": [], "← 仓库": [], "冲突": [], "删除": [], "只在一边被删（未传播）": []}
    new_state = {}
    for rel in sorted(rels):
        rp, dp = repo_path(rel), os.path.join(drive, rel)
        r, d, b = sha(rp), sha(dp), state.get(rel)
        if r == d:
            if r:
                new_state[rel] = r
            continue
        if r is None or d is None:  # 一边没有
            if b is None or (d is None and r != b) or (r is None and d != b):
                # 新文件（或删掉的那边之前就和基线不同）→ 拷过去
                src, dst, key = (rp, dp, "→ 云盘") if d is None else (dp, rp, "← 仓库")
                copy(src, dst, args.dry_run)
                log[key].append(rel)
                new_state[rel] = r or d
            elif args.delete:
                remove(dp if r is None else rp, args.dry_run)
                log["删除"].append(("云盘 " if r is None else "仓库 ") + rel)
            else:
                log["只在一边被删（未传播）"].append(("仓库删了 " if r is None else "云盘删了 ") + rel)
                new_state[rel] = b
            continue
        if d == b:
            copy(rp, dp, args.dry_run); log["→ 云盘"].append(rel); new_state[rel] = r
        elif r == b:
            copy(dp, rp, args.dry_run); log["← 仓库"].append(rel); new_state[rel] = d
        elif args.prefer == "repo":
            copy(rp, dp, args.dry_run); log["→ 云盘"].append(rel + "（冲突，以仓库为准）"); new_state[rel] = r
        elif args.prefer == "drive":
            copy(dp, rp, args.dry_run); log["← 仓库"].append(rel + "（冲突，以云盘为准）"); new_state[rel] = d
        else:
            stem, ext = os.path.splitext(rp)
            side = f"{stem}.drive-conflict-{time.strftime('%Y%m%d-%H%M')}{ext}"
            copy(dp, side, args.dry_run)
            log["冲突"].append(f"{rel} → 云盘版存为 {os.path.relpath(side, REPO)}")
            if b:
                new_state[rel] = b

    if not args.dry_run:
        os.makedirs(drive, exist_ok=True)
        tmp = state_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(new_state, f, ensure_ascii=False, indent=1, sort_keys=True)
        os.replace(tmp, state_path)

    print(f"{'[试运行] ' if args.dry_run else ''}仓库 {REPO}  ⇄  云盘 {drive}")
    for k, v in log.items():
        if v:
            print(f"{k}（{len(v)}）：")
            for x in v:
                print("  " + x)
    if not any(log.values()):
        print("两边一致，无需同步")
    sys.exit(2 if log["冲突"] else 0)


if __name__ == "__main__":
    main()
