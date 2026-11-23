"""Colab 无人值守：在内核里依次执行公开仓库里的 notebook 代码格（网页断开、标签页关掉都不会停）。

为什么需要：Colab 的「全部运行」排队在浏览器前端，网页一断，排队中的格子全部作废，GPU 空转计费。
这里用 get_ipython().run_cell 在内核里自己跑，`!` shell 命令照常可用；最后无论成败都释放运行时。

用法（在任一已连接 GPU 的 Colab 代码格里只放这两行）：
    import urllib.request; exec(urllib.request.urlopen("https://raw.githubusercontent.com/dongdongw12/shenshan_td_project/main/pipeline/colab/run_unattended.py").read().decode())
    run_jobs([("colab_gen_3d.ipynb", dict(ASSET_IDS=["fish_weir"], OVERWRITE=True)), ("colab_bake_sprites.ipynb", dict(TEST_SINGLE="", SCALE=1.0))])

- 每个 notebook 的第一个代码格是参数格：先照常执行，再用 overrides 覆盖其中的变量。
- 含 runtime.unassign() 的格子（各 notebook 的「释放运行时」）一律跳过，由 run_jobs 在全部结束后统一释放。
- jobs 里也可以放普通函数，按顺序调用（例如 set_aside 把不要的模型挪走）。
- 进度看云盘 `_unattended.log`（每格开始 / 结束一行），最后一行 UNATTENDED_DONE。
"""
import json
import os
import time
import traceback
import urllib.request

RAW = "https://raw.githubusercontent.com/dongdongw12/shenshan_td_project/main/pipeline/colab/"
LOG = "/content/drive/MyDrive/shenshan_td/_unattended.log"


def _log(msg):
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass  # 云盘还没挂载（第一个格子之前）


def run_notebook(name, overrides=None):
    ip = get_ipython()  # noqa: F821 — Colab / IPython 内核里才有
    nb = json.load(urllib.request.urlopen(RAW + name))
    cells = [c for c in nb["cells"] if c["cell_type"] == "code"]
    for n, cell in enumerate(cells):
        src = "".join(cell["source"])
        title = src.strip().splitlines()[0][:60] if src.strip() else ""
        if "runtime.unassign()" in src:
            _log(f"[{name}] 跳过释放运行时格：{title}")
            continue
        _log(f"[{name}] 格 {n} 开始：{title}")
        ok = ip.run_cell(src).success
        if n == 0 and overrides:
            ip.user_ns.update(overrides)
            _log(f"[{name}] 参数覆盖：{overrides}")
        if not ok:
            _log(f"UNATTENDED_FAIL [{name}] 格 {n}：{title}")
            return False
    _log(f"[{name}] 完成")
    return True


def set_aside(ids, drive_dir="/content/drive/MyDrive/shenshan_td"):
    """把 raw_models/<id>.glb（及 .gen.json）挪进 raw_models/_rejected/，烘培时就会改用程序化替身。"""
    rej = f"{drive_dir}/raw_models/_rejected"
    os.makedirs(rej, exist_ok=True)
    for i in ids:
        for ext in (".glb", ".gen.json"):
            src = f"{drive_dir}/raw_models/{i}{ext}"
            if os.path.exists(src):
                os.replace(src, f"{rej}/{i}{ext}")
                _log(f"挪走 {i}{ext} → raw_models/_rejected/")


def run_jobs(jobs, release=True, stop_on_fail=False):
    results = []
    try:
        for job in jobs:
            try:
                ok = job() is not False if callable(job) else run_notebook(*job)
            except Exception:  # 单步出错也继续往下跑，最后照样释放运行时
                _log("UNATTENDED_FAIL " + traceback.format_exc().replace("\n", " | ")[:800])
                ok = False
            results.append(ok)
            if not ok and stop_on_fail:
                break
        _log(f"UNATTENDED_DONE ok = {all(results)} {results}")
    finally:
        if release:
            from google.colab import runtime
            runtime.unassign()
