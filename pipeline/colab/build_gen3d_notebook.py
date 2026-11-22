"""生成 pipeline/colab/colab_gen_3d.ipynb（单元格源码在这里维护，方便 diff）。
用法：python3 pipeline/colab/build_gen3d_notebook.py pipeline/colab/colab_gen_3d.ipynb
"""
import json
import sys

OUT = sys.argv[1]

cells = []


def md(src):
    cells.append({"cell_type": "markdown", "metadata": {}, "source": src.strip("\n").splitlines(keepends=True)})


def code(src):
    cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
                  "source": src.strip("\n").splitlines(keepends=True)})


md(r"""
# 《深山传家》Colab 图生 3D：概念图 → Hunyuan3D-2 → `.glb` → 工笔风格化试烘培

一键跑完 T2 第 1 周 3 件视觉样张：`house_lv2_tile`（青瓦正房）、`tower_bamboo`（竹箭楼）、`prop_pine_tree`（深山古松）。

**流程**
1. 菜单「代码执行程序 → 更改运行时类型」选 **GPU**，并勾选 **高 RAM**：**A100 推荐**（可用 Qwen-Image 出概念图，最快）；L4 次之；T4（15GB）也能跑（自动 CPU offload，概念图只能用 HunyuanDiT）。**普通 RAM（12.7GB）会在加载模型时崩溃重启**。
2. 概念图：云盘 `shenshan_td/concepts/<id>.png` 存在就直接用（也可用即梦 / Midjourney 等按 `docs/art/T2_concept_prompts.md` 出图后放进去）；不存在且 `AUTO_T2I=True` 时自动出 4 张候选（`T2I_MODEL="auto"`：A100/L4 用 Qwen-Image，T4 用 HunyuanDiT），默认选第 1 张。
3. 想换候选：把 `concepts/_candidates/` 里更满意的那张复制成 `concepts/<id>.png`，设 `OVERWRITE=True` 从「③ 生成白模」重跑。
4. 输出：`raw_models/<id>.glb`（贴图 + 已对齐墙面朝向）、`raw_models/<id>.gen.json`（种子/参数记录）、`raw_models/_debug/`（白模与抠图），以及 `baked_sprites/_preview/` 的半比例昼/夜工笔风格化试烘培图。
5. 最后一格自动释放运行时。

**耗时参考（L4）**：首次安装 + 编译约 8–12 分钟（编译产物缓存到云盘，第二次约 2 分钟）；每件形状约 1 分钟、贴图约 2–3 分钟；试烘培每件约 1 分钟。
**模型下载**：Hunyuan3D-2 只预下载实际加载的 fp16 权重（约 16GB，原来整目录要 43GB）；概念图模型另算（HunyuanDiT 14.5GB / Qwen-Image 58GB）。默认 `HF_CACHE_ON_DRIVE=True` 全部缓存到云盘 `_cache/`，第二次起直接从云盘读。

**许可**：Hunyuan3D-2 为腾讯混元 3D 社区许可，中国大陆可商用（不含欧盟/英国/韩国；版本发布时月活 > 100 万需另行申请），腾讯不主张生成物权利。游戏只分发烘培后的 PNG，不分发模型本身。
""")

code(r'''
# ① 参数
DRIVE_DIR = "/content/drive/MyDrive/shenshan_td"
ASSET_IDS = ["house_lv2_tile", "tower_bamboo", "prop_pine_tree"]  # 留空 [] = gen_3d_jobs.json 里全部 method=ai 的资产（共 19 件）
SYNC_FROM_GITHUB = True    # 从公开仓库拉最新 manifest / 烘培脚本 / 任务表到云盘，避免云盘版本落后
GITHUB_RAW = "https://raw.githubusercontent.com/dongdongw12/shenshan_td_project/main"
HY3D_COMMIT = "f8db63096c8282cb27354314d896feba5ba6ff8a"  # 固定 Hunyuan3D-2 版本，保证可复现

AUTO_T2I = True            # 缺概念图时自动出候选；False 则要求云盘里已有 concepts/<id>.png
T2I_MODEL = "auto"         # "auto"：原生 bf16 GPU（A100/L4）用 Qwen-Image，否则 HunyuanDiT | "qwen-image" | "hunyuandit"
REGEN_CONCEPTS = []        # 填 id（如 ["tower_bamboo"]）= 强制重新出候选并覆盖 concepts/<id>.png
SHAPE_MODEL = "standard"   # "standard" = DiT-v2-0（质量优先，50 步）| "turbo" = DiT-v2-0-turbo + FlashVDM（5 步，快很多）
TEXTURE = True             # False = 只出白模（反复调形状时省时间）
LOW_VRAM = "auto"          # "auto"：显存 < 20GB 时贴图模型启用 CPU offload
OVERWRITE = False          # True = 重新生成已存在的 raw_models/<id>.glb

RUN_TEST_BAKE = True       # 生成完直接用 Blender 烘培 + 工笔风格化到 baked_sprites/_preview/
BLENDER = "5.3.0"          # 与本机 Blender 版本一致（脚本也兼容 5.0.x）
BAKE_SCALE, BAKE_SAMPLES = 0.5, 24   # 0.5 = 半比例预览（墨线同比缩放，观感一致）；正式烘培用 1.0 / 48
RELEASE_RUNTIME = True     # 最后一格释放 GPU，防止空转扣费
HF_CACHE_ON_DRIVE = True   # 模型权重缓存到云盘 _cache/hf（约 25GB），首次之后每次省去约 30–60 分钟下载
''')

code(r'''
# ② 挂载云盘、同步脚本、检查 GPU
import os, sys, json, glob, shutil, gc, math, time, subprocess, urllib.request
from google.colab import drive
drive.mount("/content/drive")
for sub in ["raw_models/_debug", "concepts/_candidates", "baked_sprites/_preview", "_cache"]:
    os.makedirs(f"{DRIVE_DIR}/{sub}", exist_ok=True)

SYNC_FILES = {  # 仓库路径 -> 云盘文件名
    "assets_manifest.json": "assets_manifest.json",
    "pipeline/blender/bake_isometric_sprites.py": "bake_isometric_sprites.py",
    "pipeline/colab/gen_3d_jobs.json": "gen_3d_jobs.json",
    "pipeline/colab/gen3d_utils.py": "gen3d_utils.py",
    "pipeline/colab/t2i_concepts.py": "t2i_concepts.py",
    "pipeline/style/stylize_sprites.py": "stylize_sprites.py",
    "pipeline/style/style_profile.json": "style_profile.json",
}
if SYNC_FROM_GITHUB:
    for src, dst in SYNC_FILES.items():
        urllib.request.urlretrieve(f"{GITHUB_RAW}/{src}", f"{DRIVE_DIR}/{dst}")
    print("已从 GitHub 同步：", ", ".join(SYNC_FILES.values()))
for dst in SYNC_FILES.values():
    assert os.path.exists(f"{DRIVE_DIR}/{dst}"), f"云盘缺少 {dst}：请开启 SYNC_FROM_GITHUB 或手动上传"

# 模型缓存：必须在任何 huggingface / diffusers / hy3dgen import 之前设置（子进程也会继承）
CACHE_ROOT = f"{DRIVE_DIR}/_cache" if HF_CACHE_ON_DRIVE else "/content/cache"
os.environ["HF_HOME"] = f"{CACHE_ROOT}/hf"
os.environ["HY3DGEN_MODELS"] = f"{CACHE_ROOT}/hy3dgen"
for k in ("HF_HOME", "HY3DGEN_MODELS"):
    os.makedirs(os.environ[k], exist_ok=True)

ram_gb = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1024**3
print(f"系统内存 {ram_gb:.1f}GB")
if ram_gb < 20:
    print("⚠️ 系统内存不足 20GB：加载 Hunyuan3D 时很可能 OOM 崩溃重启。请在「更改运行时类型」里勾选「高 RAM」后重新连接。")

sys.path.insert(0, DRIVE_DIR)
import importlib, gen3d_utils
importlib.reload(gen3d_utils)

jobs = json.load(open(f"{DRIVE_DIR}/gen_3d_jobs.json", encoding="utf-8"))
all_assets = {a["id"]: a for a in jobs["assets"]}
ids = ASSET_IDS or list(all_assets)
missing = [i for i in ids if i not in all_assets]
assert not missing, f"gen_3d_jobs.json 里没有这些 id：{missing}"
proc = [i for i in ids if all_assets[i].get("method", "ai") != "ai"]
if proc:
    print("程序化资产不走图生 3D（由 colab_bake_sprites.ipynb 用 make_proxy_assets.py 生成）：", proc)
ids = [i for i in ids if i not in proc]

def job_cfg(asset_id):
    cfg = dict(jobs["defaults"])
    cfg.update(all_assets[asset_id].get("gen", {}))
    return cfg

def concept_path(asset_id):
    return f"{DRIVE_DIR}/concepts/{asset_id}.png"

import torch
assert torch.cuda.is_available(), "请先在「更改运行时类型」里选择 GPU"
gpu = torch.cuda.get_device_properties(0)
vram_gb = gpu.total_memory / 1024**3
low_vram = (vram_gb < 20) if LOW_VRAM == "auto" else bool(LOW_VRAM)
print(f"GPU: {gpu.name} {vram_gb:.1f}GB | low_vram={low_vram} | torch {torch.__version__} | 资产: {ids}")
''')

code(r'''
# ③ 安装 Hunyuan3D-2（custom_rasterizer 编译产物缓存到云盘，第二次秒装）
HY3D_DIR = "/content/Hunyuan3D-2"
py_tag = f"cp{sys.version_info.major}{sys.version_info.minor}"
WHEEL_CACHE = f"{DRIVE_DIR}/_cache/hy3d_wheels/{py_tag}_torch{torch.__version__.replace('+', '_')}_{HY3D_COMMIT[:8]}"
os.makedirs(WHEEL_CACHE, exist_ok=True)

if not os.path.exists(HY3D_DIR):
    !git clone -q https://github.com/Tencent/Hunyuan3D-2.git {HY3D_DIR}
!cd {HY3D_DIR} && git checkout -q {HY3D_COMMIT} && git log -1 --format="Hunyuan3D-2 @ %h (%cs)"
# 只补依赖，不动 Colab 自带的 torch / torchvision
!pip install -q diffusers transformers accelerate einops omegaconf opencv-python trimesh pymeshlab pygltflib xatlas rembg onnxruntime sentencepiece protobuf ninja pybind11
!pip install -q bitsandbytes
try:  # Qwen-Image 需要 diffusers ≥ 0.35；已满足就不动，避免影响 Hunyuan3D-Paint 的自定义管线
    from diffusers import QwenImagePipeline  # noqa: F401
except ImportError:
    !pip install -q -U "diffusers>=0.35"
!pip install -q --no-deps -e {HY3D_DIR}
if HY3D_DIR not in sys.path:
    sys.path.insert(0, HY3D_DIR)

if TEXTURE:
    # 贴图光栅化 CUDA 扩展（mesh_processor 有纯 Python 回退，不用编译）
    cached = glob.glob(f"{WHEEL_CACHE}/custom_rasterizer-*.whl")
    if not cached:
        print("首次编译 custom_rasterizer（约 5–8 分钟）...")
        !cd {HY3D_DIR}/hy3dgen/texgen/custom_rasterizer && pip wheel -q --no-build-isolation --no-deps . -w "{WHEEL_CACHE}"
        cached = glob.glob(f"{WHEEL_CACHE}/custom_rasterizer-*.whl")
    assert cached, "custom_rasterizer 编译失败，往上翻看 nvcc 报错"
    !pip install -q --force-reinstall --no-deps "{cached[0]}"
    import custom_rasterizer_kernel  # 冒烟测试：能 import 说明 CUDA 扩展可用

# 只下载实际会加载的权重：形状模型 5 份同模型只要 fp16 safetensors；贴图 UNet 跳过 7.3GB 的 .bin
from huggingface_hub import snapshot_download
shape_sub = "hunyuan3d-dit-v2-0-turbo" if SHAPE_MODEL == "turbo" else "hunyuan3d-dit-v2-0"
patterns = [f"{shape_sub}/config.yaml", f"{shape_sub}/model.fp16.safetensors"]
if TEXTURE:
    patterns += ["hunyuan3d-delight-v2-0/*", "hunyuan3d-paint-v2-0-turbo/*"]
t0 = time.time()
snapshot_download("tencent/Hunyuan3D-2", local_dir=f"{os.environ['HY3DGEN_MODELS']}/tencent/Hunyuan3D-2",
                  allow_patterns=patterns, ignore_patterns=["*unet/diffusion_pytorch_model.bin"])
print(f"Hunyuan3D-2 权重就绪（{time.time() - t0:.0f}s，缓存在 {os.environ['HY3DGEN_MODELS']}）")
print("Hunyuan3D-2 就绪")
''')

code(r'''
# ④ 概念图：已有就用，没有就在独立进程里出 4 张候选（默认选第 1 张；进程退出后内存全部释放）
from PIL import Image
import matplotlib.pyplot as plt

need_t2i = [i for i in ids if i in REGEN_CONCEPTS or not os.path.exists(concept_path(i))]
print("已有概念图：", [i for i in ids if i not in need_t2i], "| 需要生成：", need_t2i)

if need_t2i:
    assert AUTO_T2I, "缺概念图：请按 docs/art/T2_concept_prompts.md 出图后放到云盘 concepts/<id>.png，或设 AUTO_T2I=True"
    regen = ",".join(i for i in need_t2i if i in REGEN_CONCEPTS)
    !cd {HY3D_DIR} && python "{DRIVE_DIR}/t2i_concepts.py" --jobs "{DRIVE_DIR}/gen_3d_jobs.json" --out "{DRIVE_DIR}/concepts" --ids "{','.join(need_t2i)}" --model {T2I_MODEL} --regen "{regen}" 2>&1 | grep -vE "it/s\]|s/it\]|^\s*$"
    assert all(os.path.exists(concept_path(i)) for i in need_t2i), "概念图生成失败，往上翻看报错"

for i in ids:
    imgs = [concept_path(i)] + sorted(glob.glob(f"{DRIVE_DIR}/concepts/_candidates/{i}_*s*.png"),
                                      key=os.path.getmtime, reverse=True)[:8]
    fig, axes = plt.subplots(1, len(imgs), figsize=(3.2 * len(imgs), 3.4), squeeze=False)
    for ax, p in zip(axes[0], imgs):
        ax.imshow(Image.open(p)); ax.axis("off")
        ax.set_title(("[IN USE] " if p == imgs[0] else "") + os.path.basename(p), fontsize=8)
    plt.show()
''')

code(r'''
# ⑤ 生成白模：抠图 → Hunyuan3D-DiT → 去浮块/退化面 → 减面到 max_faces
import trimesh
from hy3dgen.rembg import BackgroundRemover
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline, FloaterRemover, DegenerateFaceRemover, FaceReducer

todo = [i for i in ids if OVERWRITE or not os.path.exists(f"{DRIVE_DIR}/raw_models/{i}.glb")]
print("待生成：", todo, "| 已存在跳过：", [i for i in ids if i not in todo])

rembg = BackgroundRemover()
def load_rgba(path):
    img = Image.open(path)
    if img.mode == "RGBA" and img.getextrema()[3][0] < 250:  # 已经是透明底
        return img
    return rembg(img.convert("RGB"))

images, meshes, logs = {}, {}, {}
if todo:
    if SHAPE_MODEL == "turbo":
        shape_pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            "tencent/Hunyuan3D-2", subfolder="hunyuan3d-dit-v2-0-turbo", use_safetensors=True)
        shape_pipe.enable_flashvdm()
    else:
        shape_pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            "tencent/Hunyuan3D-2", subfolder="hunyuan3d-dit-v2-0")
    for i in todo:
        cfg, t0 = job_cfg(i), time.time()
        img = load_rgba(concept_path(i))
        img.save(f"{DRIVE_DIR}/raw_models/_debug/{i}_input_rgba.png")
        steps = 5 if SHAPE_MODEL == "turbo" else cfg["num_inference_steps"]
        mesh = shape_pipe(image=img, num_inference_steps=steps, octree_resolution=cfg["octree_resolution"],
                          num_chunks=20000, generator=torch.manual_seed(cfg["shape_seed"]), output_type="trimesh")[0]
        raw_faces = len(mesh.faces)
        mesh = FloaterRemover()(mesh)
        mesh = DegenerateFaceRemover()(mesh)
        mesh = FaceReducer()(mesh, max_facenum=cfg["max_faces"])
        mesh.export(f"{DRIVE_DIR}/raw_models/_debug/{i}_white.glb")
        images[i], meshes[i] = img, mesh
        logs[i] = {"id": i, "concept": os.path.basename(concept_path(i)), "shape_model": SHAPE_MODEL,
                   "shape_seed": cfg["shape_seed"], "steps": steps, "octree_resolution": cfg["octree_resolution"],
                   "faces_raw": raw_faces, "faces": len(mesh.faces), "hy3d_commit": HY3D_COMMIT}
        print(f"{i}: {raw_faces} → {len(mesh.faces)} 面，用时 {time.time() - t0:.0f}s")
    del shape_pipe
    gc.collect(); torch.cuda.empty_cache()
''')

code(r'''
# ⑥ 贴图 → 墙面朝向对齐 → 导出 raw_models/<id>.glb
if todo and TEXTURE:
    from hy3dgen.texgen import Hunyuan3DPaintPipeline
    paint = Hunyuan3DPaintPipeline.from_pretrained("tencent/Hunyuan3D-2")  # 默认 paint-v2-0-turbo
    if low_vram:
        paint.enable_model_cpu_offload()
    for i in todo:
        t0 = time.time()
        meshes[i] = paint(meshes[i], image=images[i])
        print(f"{i}: 贴图完成，用时 {time.time() - t0:.0f}s")
    del paint
    gc.collect(); torch.cuda.empty_cache()

for i in todo:
    cfg, mesh = job_cfg(i), meshes[i]
    # 必须先贴图再旋转：Hunyuan3D-Paint 假定概念图就是模型正面（glTF +Z）
    yaw = {"yaw_deg": 0.0, "reliable": False, "gain": 0.0}
    if cfg["auto_align_yaw"]:
        yaw = gen3d_utils.yaw_align_deg(gen3d_utils.subsample(mesh.vertices.tolist()))
    total_yaw = yaw["yaw_deg"] + float(cfg.get("yaw_extra_deg", 0))
    if abs(total_yaw) > 1e-3:
        mesh.apply_transform(trimesh.transformations.rotation_matrix(math.radians(total_yaw), [0, 1, 0]))
    out = f"{DRIVE_DIR}/raw_models/{i}.glb"
    mesh.export(out)
    logs[i].update({"textured": TEXTURE, "auto_align": yaw, "yaw_applied_deg": round(total_yaw, 3),
                    "glb_mb": round(os.path.getsize(out) / 1024**2, 2),
                    "created": time.strftime("%Y-%m-%d %H:%M:%S")})
    with open(f"{DRIVE_DIR}/raw_models/{i}.gen.json", "w", encoding="utf-8") as f:
        json.dump(logs[i], f, ensure_ascii=False, indent=2)
    print(f"{i}: 偏航修正 {total_yaw:+.1f}°（auto={yaw}）→ {out}")
''')

code(r'''
# ⑦ 快速体检：概念图 / 俯视脚印（墙应与坐标轴平行）/ 正视剖面
import numpy as np
for i in ids:
    p = f"{DRIVE_DIR}/raw_models/{i}.glb"
    if not os.path.exists(p):
        continue
    m = trimesh.load(p, force="mesh")
    v = m.vertices[np.random.default_rng(0).choice(len(m.vertices), min(8000, len(m.vertices)), replace=False)]
    fig, ax = plt.subplots(1, 3, figsize=(13, 4.2))
    ax[0].imshow(Image.open(concept_path(i))); ax[0].axis("off"); ax[0].set_title(f"{i} concept")
    ax[1].scatter(v[:, 0], v[:, 2], s=0.2, c=v[:, 1], cmap="viridis"); ax[1].set_aspect("equal"); ax[1].invert_yaxis()
    ax[1].set_title("top view x/z (front = +z, bottom edge)")
    ax[2].scatter(v[:, 0], v[:, 1], s=0.2, c=v[:, 2], cmap="viridis"); ax[2].set_aspect("equal")
    ax[2].set_title(f"front view x/y | {len(m.faces)} faces")
    plt.show()
''')

code(r'''
# ⑧ 半比例试烘培 + 工笔风格化（输出到 baked_sprites/_preview/，不会挡住之后的正式批量烘培）
def checker(size, cell=16):
    bg = Image.new("RGBA", (size, size), (235, 235, 235, 255))
    px = bg.load()
    for y in range(size):
        for x in range(size):
            if (x // cell + y // cell) % 2:
                px[x, y] = (200, 200, 200, 255)
    return bg

if RUN_TEST_BAKE:
    mm = ".".join(BLENDER.split(".")[:2])
    if not os.path.exists("/content/blender/blender"):
        !apt-get -qq install -y libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libsm6 libgl1 libegl1 > /dev/null
        !wget -q https://download.blender.org/release/Blender{mm}/blender-{BLENDER}-linux-x64.tar.xz -O /content/blender.tar.xz
        !mkdir -p /content/blender && tar -xf /content/blender.tar.xz -C /content/blender --strip-components=1
    # 风格化依赖 Blender 自带 Python 的 numpy + OpenImageIO；没有的话改用 Colab Python 单独跑
    has_oiio = "OK" in subprocess.run(["/content/blender/blender", "-b", "--python-expr", "import OpenImageIO; print('OK')"],
                                      capture_output=True, text=True).stdout
    skip = "" if has_oiio else "--skip-stylize"
    if not has_oiio:
        !pip install -q OpenEXR pillow
    prev_dir = f"{DRIVE_DIR}/baked_sprites/_preview"
    for i in ids:
        glb = f"{DRIVE_DIR}/raw_models/{i}.glb"
        if not os.path.exists(glb):
            continue
        !/content/blender/blender -b -P "{DRIVE_DIR}/bake_isometric_sprites.py" -- --input "{glb}" --out "{prev_dir}" --manifest "{DRIVE_DIR}/assets_manifest.json" --profile "{DRIVE_DIR}/style_profile.json" --scale {BAKE_SCALE} --samples {BAKE_SAMPLES} --overwrite {skip} 2>&1 | grep -E "^BAKE|^RENDERED|^BAKED|Error|Traceback"
        if not has_oiio:
            !python "{DRIVE_DIR}/stylize_sprites.py" --passes "{prev_dir}/_passes" --out "{prev_dir}" --profile "{DRIVE_DIR}/style_profile.json" --only {i}
        for meta_path in sorted(glob.glob(f"{prev_dir}/{i}*_meta.json")):
            meta = json.load(open(meta_path, encoding="utf-8"))
            fig, axes = plt.subplots(1, 2, figsize=(11, 5.6))
            for ax, key in zip(axes, ["day_file", "night_file"]):
                sprite = Image.open(f"{prev_dir}/{meta[key]}").convert("RGBA")
                comp = checker(sprite.width); comp.alpha_composite(sprite)
                ax.imshow(comp); ax.plot(*meta["anchor_px"], "r+", ms=14, mew=2); ax.axis("off")
                ax.set_title(f"{meta[key]}  anchor={meta['anchor_px']}  {meta.get('px_per_meter')}px/m", fontsize=9)
            plt.show()
''')

code(r'''
# ⑨ 释放 Colab GPU 运行时（结果都已写入云盘）
if RELEASE_RUNTIME:
    from google.colab import runtime
    runtime.unassign()
''')

nb = {
    "cells": cells,
    "metadata": {
        "accelerator": "GPU",
        "colab": {"provenance": [], "gpuType": "L4"},
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    },
    "nbformat": 4,
    "nbformat_minor": 0,
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(nb, f, ensure_ascii=False, indent=1)
    f.write("\n")
print("wrote", OUT, len(cells), "cells")
