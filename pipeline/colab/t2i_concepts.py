"""
《深山传家》概念图生成（独立进程运行，跑完显存/内存全部释放，再加载 Hunyuan3D 不会 OOM）。

模型：
  qwen-image  Qwen/Qwen-Image（Apache-2.0，无需登录；中文长提示词遵循度高）。需要原生 bf16 的 GPU（A100 / L4 / H100），
              transformer 与 text_encoder 用 bitsandbytes 4bit 量化加载，约 16GB 显存；首次下载约 58GB（建议缓存到云盘）。
  hunyuandit  Tencent-Hunyuan/HunyuanDiT-v1.1-Distilled（T4 也能跑，但实测“箭楼”会画成宝塔、“正房”会画成红墙庙宇）。
  auto        有原生 bf16 → qwen-image，否则 hunyuandit；qwen-image 任何报错都自动退回 hunyuandit。

输出：<out>/_candidates/<id>_<model>_s<seed>.png；<out>/<id>.png 不存在（或 id 在 --regen 里）时用第一张候选。
用法：
  python t2i_concepts.py --jobs gen_3d_jobs.json --out /content/drive/MyDrive/shenshan_td/concepts \
      --ids house_lv2_tile,tower_bamboo --model auto [--regen tower_bamboo]
"""

import argparse
import gc
import json
import os
import shutil
import sys
import time
import traceback


def log(msg):
    print(msg, flush=True)


def has_native_bf16():
    import torch
    if not torch.cuda.is_available():
        return False
    major, _ = torch.cuda.get_device_capability(0)
    return major >= 8  # Ampere 及以上（A100/L4/H100）；T4 = 7.5


def safetensors_ok(path):
    """只读文件头检查 .safetensors 是否完整：头长度合理、头是 JSON、文件大小正好等于 8 + 头长 + 数据末尾偏移。
    云盘不支持符号链接，HF 缓存会退化成整份拷贝，中途崩溃 / 断线就会留下截断的文件（加载时报 "header too large"）。"""
    import struct
    try:
        size = os.path.getsize(path)
        if size < 16:
            return False
        with open(path, "rb") as f:
            n = struct.unpack("<Q", f.read(8))[0]
            if n <= 0 or n > size - 8 or n > 200_000_000:
                return False
            header = json.loads(f.read(n))
    except (OSError, ValueError, struct.error):
        return False
    end = max((v["data_offsets"][1] for k, v in header.items() if k != "__metadata__"), default=0)
    return size == 8 + n + end


def repair_hf_cache(repo):
    """先补齐缺的文件，再把损坏的 .safetensors 删掉强制重下。返回重下的文件列表。"""
    from huggingface_hub import hf_hub_download, snapshot_download
    local = snapshot_download(repo)
    bad = []
    for root, _, files in os.walk(local):
        for fn in files:
            if fn.endswith(".safetensors") and not safetensors_ok(os.path.join(root, fn)):
                bad.append(os.path.relpath(os.path.join(root, fn), local))
    for rel in bad:
        log(f"权重文件损坏，重新下载：{repo}/{rel}")
        path = os.path.join(local, rel)
        for q in {path, os.path.realpath(path)}:
            try:
                os.remove(q)
            except FileNotFoundError:
                pass
        hf_hub_download(repo, rel, force_download=True)
    return bad


def load_qwen_image():
    import torch
    from diffusers import BitsAndBytesConfig as DiffusersBnb
    from diffusers import DiffusionPipeline
    from diffusers.quantizers import PipelineQuantizationConfig
    from transformers import BitsAndBytesConfig as TransformersBnb

    # transformer 与 text_encoder 分开配：transformer 第 0 个块的 img_mod（调制层）保持 bf16 不量化 ——
    # 整个 transformer 一刀切 4bit 时出图满屏噪点（像没去噪完），T2 第二次跑就是这样
    nf4 = {"load_in_4bit": True, "bnb_4bit_quant_type": "nf4", "bnb_4bit_compute_dtype": torch.bfloat16}
    qc = PipelineQuantizationConfig(quant_mapping={
        "transformer": DiffusersBnb(**nf4, llm_int8_skip_modules=["transformer_blocks.0.img_mod"]),
        "text_encoder": TransformersBnb(**nf4),
    })
    repair_hf_cache("Qwen/Qwen-Image")
    pipe = DiffusionPipeline.from_pretrained("Qwen/Qwen-Image", torch_dtype=torch.bfloat16, quantization_config=qc)
    pipe.enable_model_cpu_offload()

    def run(asset, style, seed):
        prompt = f"{asset.get('prefix_zh', style['prefix_zh'])}{asset['prompt_zh']}"  # 单件可换画风前缀（鱼梁：去掉“建筑 / 黛瓦 / 白墙”）
        g = torch.Generator(device="cuda").manual_seed(int(seed))
        negative = style["negative_zh"] + ("，" + asset["negative_zh"] if asset.get("negative_zh") else "")  # 单件可追加反向词
        return pipe(prompt=prompt, negative_prompt=negative, width=1024, height=1024,
                    num_inference_steps=50, true_cfg_scale=4.0, generator=g).images[0]
    return pipe, run


def grain_level(img):
    """噪点强度：图像与 3×3 中值滤波之差的标准差（0–255）。干净的概念图一般 < 6，满屏噪点 > 12。"""
    import numpy as np
    from PIL import ImageFilter
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    m = np.asarray(img.convert("RGB").filter(ImageFilter.MedianFilter(3)), dtype=np.float32)
    return float((a - m).std())


def clean_grain(img, threshold=8.0):
    """噪点超过阈值才做非局部均值去噪（保边），返回 (图, 去噪前噪点, 去噪后噪点)。"""
    before = grain_level(img)
    if before <= threshold:
        return img, before, before
    import cv2
    import numpy as np
    from PIL import Image
    bgr = cv2.cvtColor(np.asarray(img.convert("RGB")), cv2.COLOR_RGB2BGR)
    h = min(15.0, 3.0 + before * 0.6)
    out = cv2.fastNlMeansDenoisingColored(bgr, None, h, h, 7, 21)
    res = Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))
    return res, before, grain_level(res)


def load_hunyuandit():
    from hy3dgen.text2image import HunyuanDiTPipeline
    pipe = HunyuanDiTPipeline("Tencent-Hunyuan/HunyuanDiT-v1.1-Diffusers-Distilled")

    def run(asset, style, seed):
        prompt = asset["t2i_zh"]
        if len(prompt) > 60:
            log(f"WARN {asset['id']} 的 t2i_zh 有 {len(prompt)} 字，HunyuanDiT 只读前 60 字")
        return pipe(prompt, seed=int(seed))
    return pipe, run


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--jobs", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--ids", required=True, help="逗号分隔，需要出图的资产 id")
    p.add_argument("--model", default="auto", choices=["auto", "qwen-image", "hunyuandit"])
    p.add_argument("--regen", default="", help="逗号分隔：即使已有 <id>.png 也用新候选覆盖")
    args = p.parse_args()

    jobs = json.load(open(args.jobs, encoding="utf-8"))
    assets = {a["id"]: a for a in jobs["assets"]}
    style = jobs["style"]
    ids = [i for i in args.ids.split(",") if i]
    regen = {i for i in args.regen.split(",") if i}
    cand_dir = os.path.join(args.out, "_candidates")
    os.makedirs(cand_dir, exist_ok=True)

    model = args.model
    if model == "auto":
        model = "qwen-image" if has_native_bf16() else "hunyuandit"
    log(f"T2I_MODEL: {model}")

    try:
        pipe, run = load_qwen_image() if model == "qwen-image" else load_hunyuandit()
    except Exception:
        if model != "qwen-image":
            raise
        traceback.print_exc()
        log("WARN Qwen-Image 加载失败，退回 HunyuanDiT")
        model = "hunyuandit"
        gc.collect()
        pipe, run = load_hunyuandit()

    summary = {}
    for i in ids:
        asset = assets[i]
        seeds = asset.get("gen", {}).get("t2i_seeds", jobs["defaults"]["t2i_seeds"])
        cands = []
        for seed in seeds:
            t0 = time.time()
            path = os.path.join(cand_dir, f"{i}_{model}_s{seed}.png")
            img = run(asset, style, seed)
            img, g0, g1 = clean_grain(img)
            img.save(path)
            cands.append(path)
            note = f"，噪点 {g0:.1f}" + (f" → 去噪后 {g1:.1f}" if g1 != g0 else "")
            log(f"{i}: {os.path.basename(path)} ({time.time() - t0:.0f}s{note})")
        target = os.path.join(args.out, f"{i}.png")
        if i in regen or not os.path.exists(target):
            shutil.copy(cands[0], target)
            log(f"{i}: 选用 {os.path.basename(cands[0])} → {os.path.basename(target)}")
        summary[i] = [os.path.basename(c) for c in cands]
    with open(os.path.join(cand_dir, "_last_run.json"), "w", encoding="utf-8") as f:
        json.dump({"model": model, "candidates": summary, "time": time.strftime("%Y-%m-%d %H:%M:%S")},
                  f, ensure_ascii=False, indent=2)
    del pipe
    gc.collect()
    log("T2I_DONE")


if __name__ == "__main__":
    sys.exit(main())
